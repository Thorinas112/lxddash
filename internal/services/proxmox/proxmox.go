package proxmox

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"lxddash/internal/services/libvirt"
	"lxddash/internal/services/lxd"
)

// Backup describes a vzdump backup file found in the dump directory.
type Backup struct {
	Path     string    `json:"path"`
	Filename string    `json:"filename"`
	VMID     int       `json:"vmid"`
	Type     string    `json:"type"`   // "qemu" or "lxc"
	Format   string    `json:"format"` // e.g. "vma.zst", "tar.zst"
	Size     int64     `json:"size"`
	ModTime  time.Time `json:"mod_time"`
}

var backupRe = regexp.MustCompile(`^vzdump-(qemu|lxc)-(\d+)-([\d_\-]{10,25})\.(tar|vma)\.(gz|zst|lzo|xz)$`)

// Task tracks an in-flight import operation.
type Task struct {
	ID        string    `json:"id"`
	VMID      int       `json:"vmid"`
	Type      string    `json:"type"` // "qemu" or "lxc"
	Source    string    `json:"source"`
	Status    string    `json:"status"`   // running | done | failed
	Progress  int       `json:"progress"` // 0-100
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Service imports Proxmox vzdump backups:
//   - LXC containers are extracted and imported into LXD
//   - QEMU VMs are extracted with the `vma` tool and defined in libvirt
type Service struct {
	dumpDir    string
	stagingDir string
	vmImageDir string
	lxd        *lxd.Service
	libvirt    *libvirt.Service

	mu    sync.Mutex
	tasks []*Task
}

func New(dumpDir, stagingDir, vmImageDir string, lxdSvc *lxd.Service, libvirtSvc *libvirt.Service) *Service {
	return &Service{
		dumpDir:    dumpDir,
		stagingDir: stagingDir,
		vmImageDir: vmImageDir,
		lxd:        lxdSvc,
		libvirt:    libvirtSvc,
	}
}

// Backups lists vzdump backups in the configured dump directory.
func (s *Service) Backups() ([]Backup, error) {
	entries, err := os.ReadDir(s.dumpDir)
	if err != nil {
		return nil, err
	}
	out := []Backup{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := backupRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		vmid := 0
		fmt.Sscanf(m[2], "%d", &vmid)
		out = append(out, Backup{
			Path:     filepath.Join(s.dumpDir, e.Name()),
			Filename: e.Name(),
			VMID:     vmid,
			Type:     m[1],
			Format:   m[4] + "." + m[5],
			Size:     info.Size(),
			ModTime:  info.ModTime(),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime.After(out[j].ModTime) })
	return out, nil
}

// Upload saves an uploaded vzdump backup file into the dump directory.
// The filename must match the vzdump naming convention so it can be
// listed and imported afterwards.
func (s *Service) Upload(filename string, r io.Reader) (string, error) {
	base := filepath.Base(filename)
	if !backupRe.MatchString(base) {
		return "", fmt.Errorf("invalid vzdump filename %q (expected e.g. vzdump-lxc-100-2026_09_27-10_57_48.tar.zst)", base)
	}
	if err := os.MkdirAll(s.dumpDir, 0o755); err != nil {
		return "", err
	}
	dst := filepath.Join(s.dumpDir, base)
	f, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := io.Copy(f, r); err != nil {
		os.Remove(dst)
		return "", err
	}
	return dst, nil
}

// Delete removes a backup file from the dump directory.
func (s *Service) Delete(filename string) error {
	base := filepath.Base(filename)
	if !backupRe.MatchString(base) {
		return fmt.Errorf("invalid vzdump filename %q", base)
	}
	return os.Remove(filepath.Join(s.dumpDir, base))
}

// Import starts an asynchronous import of the given backup file and
// returns the task handle immediately.
func (s *Service) Import(ctx context.Context, path string) (*Task, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	base := filepath.Base(abs)
	m := backupRe.FindStringSubmatch(base)
	if m == nil {
		return nil, fmt.Errorf("not a valid vzdump backup: %s", base)
	}
	vmid := 0
	fmt.Sscanf(m[2], "%d", &vmid)

	task := &Task{
		ID:        fmt.Sprintf("%s-%d-%d", m[1], vmid, time.Now().Unix()),
		VMID:      vmid,
		Type:      m[1],
		Source:    base,
		Status:    "running",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	s.mu.Lock()
	s.tasks = append(s.tasks, task)
	s.mu.Unlock()

	go func() {
		var err error
		if task.Type == "lxc" {
			err = s.importCT(context.Background(), abs, task)
		} else {
			err = s.importVM(context.Background(), abs, task)
		}
		s.mu.Lock()
		if err != nil {
			task.Status = "failed"
			task.Message = err.Error()
		} else {
			task.Status = "done"
			task.Message = "import completed"
		}
		task.UpdatedAt = time.Now()
		s.mu.Unlock()
	}()

	return task, nil
}

// Tasks returns a snapshot of all import tasks.
func (s *Service) Tasks() []*Task {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Task, len(s.tasks))
	copy(out, s.tasks)
	return out
}

func (s *Service) update(task *Task, msg string) {
	s.updateProgress(task, task.Progress, msg)
}

func (s *Service) updateProgress(task *Task, pct int, msg string) {
	task.Progress = pct
	task.Message = msg
	task.UpdatedAt = time.Now()
}

// importCT extracts a Proxmox LXC backup and imports it into LXD.
func (s *Service) importCT(ctx context.Context, path string, task *Task) error {
	if s.lxd == nil {
		return fmt.Errorf("LXD service is not available")
	}
	if _, err := exec.LookPath("lxc"); err != nil {
		return fmt.Errorf("the 'lxc' CLI is required for container imports (apt install lxd-client)")
	}

	dir := filepath.Join(s.stagingDir, task.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	s.updateProgress(task, 10, "extracting backup archive")
	if err := extractArchive(path, dir); err != nil {
		return err
	}

	// Newer Proxmox backups store config at etc/vzdump/pct.conf and extract
	// the rootfs flat (no rootfs/ subdirectory). Older backups use config +
	// rootfs/ at the archive root.
	cfgPath := filepath.Join(dir, "config")
	if _, err := os.Stat(cfgPath); err != nil {
		cfgPath = filepath.Join(dir, "etc", "vzdump", "pct.conf")
	}
	cfg, err := parsePVEConfig(cfgPath)
	if err != nil {
		return err
	}

	rootfsDir := filepath.Join(dir, "rootfs")
	if _, err := os.Stat(rootfsDir); err != nil {
		// Newer format: rootfs is flat — files are directly in dir.
		// Use the staging dir itself as the rootfs source.
		rootfsDir = dir
	}

	name := cfg.Hostname
	if name == "" {
		name = fmt.Sprintf("pve-ct-%d", task.VMID)
	}

	// Fresh servers never pulled the base image that instances are created
	// from — pull it automatically (first import only) instead of dying with
	// LXD's cryptic "Image not provided for instance creation".
	s.updateProgress(task, 25, "checking base image (ubuntu-minimal)")
	pulled, err := s.lxd.EnsureImageAlias(ctx, "ubuntu-minimal", "ubuntu:24.04")
	if err != nil {
		return err
	}
	if pulled {
		s.updateProgress(task, 28, "pulled base image ubuntu-minimal (first import)")
	}

	s.updateProgress(task, 30, fmt.Sprintf("creating LXD container %q", name))
	instReq := lxd.CreateRequest{
		Name: name,
		Type: "container",
		// Create from a base image so the rootfs volume exists and can
		// be mounted. The extracted Proxmox rootfs is pushed over it.
		Image: "ubuntu-minimal",
		Config: map[string]string{
			"limits.cpu":    fmt.Sprintf("%d", cfg.Cores),
			"limits.memory": fmt.Sprintf("%dMiB", cfg.Memory),
		},
	}
	if cfg.RootfsSize != "" {
		instReq.Devices = map[string]map[string]string{
			"root": {"type": "disk", "path": "/", "size": toLXDSize(cfg.RootfsSize), "pool": "default"},
		}
	}
	if err := s.lxd.CreateInstance(ctx, instReq); err != nil {
		return fmt.Errorf("create instance: %w", err)
	}

	// Start the container so its rootfs is mounted and writable,
	// then push the extracted rootfs files into it.
	s.updateProgress(task, 50, "starting container to mount rootfs")
	if err := s.lxd.SetState(ctx, name, "start"); err != nil {
		return fmt.Errorf("start instance: %w", err)
	}

	s.updateProgress(task, 60, "copying rootfs into container (this can take a while)")

	// Use lxc file push which handles the rootfs correctly (preserves boot).
	pushEnv := append(os.Environ(), "PATH=/snap/bin:"+os.Getenv("PATH"))
	cmd := exec.CommandContext(ctx, "lxc", "file", "push", "-r", rootfsDir+"/.", name+"/")
	cmd.Env = pushEnv
	_, _ = cmd.CombinedOutput()
	// lxc file push returns exit 1 for some special files (sockets, etc)
	// but still pushes the vast majority of files successfully.

	dockerMsg := ""
	s.updateProgress(task, 80, "checking for Docker installation")
	// Post-import: if Docker was in the backup, reinstall it since the rootfs
	// push can't reliably transfer Docker's special files and large /var/lib/docker.
	dockerDir := filepath.Join(rootfsDir, "etc", "docker")
	if _, err := os.Stat(dockerDir); err == nil {
		s.updateProgress(task, 82, "installing Docker (detected in backup)")
		_, _ = s.lxd.ExecOutput(ctx, name, []string{"sh", "-c",
			"curl -fsSL https://get.docker.com | sh 2>&1 | tail -5"})

		s.updateProgress(task, 90, "restoring Docker configuration")
		dockerConfSrc := filepath.Join(rootfsDir, "etc", "docker", "daemon.json")
		if data, err := os.ReadFile(dockerConfSrc); err == nil {
			_ = s.lxd.WriteFile(ctx, name, "/etc/docker/daemon.json", data, 0o644)
		}
		// Find a compose file anywhere sensible in the rootfs — the old
		// hardcoded /home/mark path only matched the WSL test environment.
		composeSrc := ""
		for _, pattern := range []string{
			"/root/docker-compose.y*ml",
			"/root/compose/docker-compose.y*ml",
			"/home/*/docker-compose.y*ml",
			"/home/*/*/docker-compose.y*ml",
		} {
			if matches, _ := filepath.Glob(filepath.Join(rootfsDir, pattern)); len(matches) > 0 {
				composeSrc = matches[0]
				break
			}
		}
		if composeSrc != "" {
			rel := strings.TrimPrefix(composeSrc, rootfsDir)
			data, _ := os.ReadFile(composeSrc)
			_ = s.lxd.WriteFile(ctx, name, "/root/docker-compose.yml", data, 0o644)
			s.updateProgress(task, 95, "recreating containers from "+rel+" (images re-pull automatically)")
			_, _ = s.lxd.ExecOutput(ctx, name, []string{"sh", "-c",
				"systemctl start docker && cd /root && docker compose up -d 2>&1 | tail -8"})
			dockerMsg = "docker reinstalled; compose up from " + rel
		} else {
			_, _ = s.lxd.ExecOutput(ctx, name, []string{"sh", "-c", "systemctl start docker"})
			dockerMsg = "docker reinstalled — no compose file found in backup; recreate containers manually"
		}
		s.updateProgress(task, 98, "Docker installed and running")
	}

	finalMsg := "container imported successfully"
	if dockerMsg != "" {
		finalMsg += " — " + dockerMsg
	}
	s.updateProgress(task, 100, finalMsg)
	return nil
}

// importVM extracts a Proxmox QEMU backup (VMA) and defines the VM in libvirt.
func (s *Service) importVM(ctx context.Context, path string, task *Task) error {
	if s.libvirt == nil {
		return fmt.Errorf("libvirt service is not available")
	}
	if _, err := exec.LookPath("vma"); err != nil {
		return fmt.Errorf("the 'vma' tool is required for VM imports (install from Proxmox: apt install vma)")
	}
	if _, err := exec.LookPath("qemu-img"); err != nil {
		return fmt.Errorf("qemu-img is required for VM imports (apt install qemu-utils)")
	}

	dir := filepath.Join(s.stagingDir, task.ID)
	// `vma extract` creates the target directory itself and aborts with
	// "unable to create target directory - File exists" if it is already
	// there. Clear leftovers from any previous (killed) run instead of
	// pre-creating it — same approach as Proxmox's restore (rmtree first).
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	s.update(task, "extracting VMA archive")
	if err := runVMAExtract(ctx, path, dir); err != nil {
		return err
	}

	// vma extract writes raw disk images named after the Proxmox drive
	// config (tmp-disk-drive-*.raw); .img kept as fallback for older versions.
	disks, _ := filepath.Glob(filepath.Join(dir, "*.raw"))
	if len(disks) == 0 {
		disks, _ = filepath.Glob(filepath.Join(dir, "*.img"))
	}
	if len(disks) == 0 {
		return fmt.Errorf("no disk images found in VMA archive")
	}

	cfg, err := parsePVEConfig(filepath.Join(dir, "qemu-server.conf"))
	if err != nil {
		return err
	}
	name := cfg.Hostname
	if name == "" {
		name = fmt.Sprintf("pve-vm-%d", task.VMID)
	}

	if err := os.MkdirAll(s.vmImageDir, 0o755); err != nil {
		return err
	}
	qcow := filepath.Join(s.vmImageDir, name+".qcow2")

	// Pick the OS disk: the config's boot disk if it was extracted,
	// otherwise the largest image (helper disks like the 4M efidisk0
	// sort first alphabetically and must not win).
	disk := pickBootDisk(disks, cfg.BootDisk)

	s.update(task, "converting disk image to qcow2")
	cmd := exec.CommandContext(ctx, "qemu-img", "convert", "-O", "qcow2", disk, qcow)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("qemu-img convert failed: %v: %s", err, out)
	}

	// OVMF (UEFI) VMs need a persistent NVRAM store: reuse the extracted
	// efidisk0 (Proxmox's EFI vars image, copied out of staging before it
	// is cleaned up) or seed one from the local OVMF_VARS template.
	var ovmfCode, nvram string
	if cfg.Bios == "ovmf" {
		code, varsTmpl := findOVMF()
		src := findFileContains(disks, "efidisk")
		if src == "" {
			src = varsTmpl
		}
		if code != "" && src != "" {
			ovmfCode = code
			nvram = filepath.Join(s.vmImageDir, name+"_VARS.fd")
			if err := copyFile(src, nvram); err != nil {
				return fmt.Errorf("prepare EFI NVRAM: %w", err)
			}
		}
	}

	s.update(task, "defining VM in libvirt")
	xml := buildDomainXML(name, cfg.Memory, cfg.Cores, qcow, ovmfCode, nvram, latestQ35Machine())
	if err := s.libvirt.DefineXML(xml); err != nil {
		return fmt.Errorf("define domain: %w", err)
	}

	s.update(task, "VM imported successfully")
	return nil
}

// vmaDecompressor returns the decompressor command that turns a compressed
// vzdump VMA archive into a raw VMA stream, plus the apt package that
// provides it. Returns nil when the archive is not compressed.
func vmaDecompressor(path string) (cmd []string, pkg string) {
	switch {
	case strings.HasSuffix(path, ".zst"):
		return []string{"zstd", "-d", "-c"}, "zstd"
	case strings.HasSuffix(path, ".gz"):
		return []string{"gzip", "-dc"}, "gzip"
	case strings.HasSuffix(path, ".xz"):
		return []string{"xz", "-dc"}, "xz-utils"
	case strings.HasSuffix(path, ".lzo"):
		return []string{"lzop", "-dc"}, "lzop"
	}
	return nil, ""
}

// runVMAExtract extracts a VMA archive into dir.
//
// The `vma` tool only understands a raw VMA stream (it aborts with
// "wrong magic number" on compressed input), so compressed vzdump
// archives are piped through a decompressor first — the same approach
// Proxmox uses in restore_vma_archive: zstd|gzip|xz|lzop | vma extract -.
func runVMAExtract(ctx context.Context, path, dir string) error {
	decomp, pkg := vmaDecompressor(path)
	vmaArgs := []string{"extract", path, dir}

	var dec *exec.Cmd
	if decomp != nil {
		if _, err := exec.LookPath(decomp[0]); err != nil {
			return fmt.Errorf("'%s' is required to extract %s (apt install %s)",
				decomp[0], filepath.Base(path), pkg)
		}
		decArgs := append(append([]string{}, decomp[1:]...), path)
		dec = exec.CommandContext(ctx, decomp[0], decArgs...)
		vmaArgs = []string{"extract", "-", dir} // read raw VMA stream from stdin
	}

	vma := exec.CommandContext(ctx, "vma", vmaArgs...)
	if dec == nil {
		if out, err := vma.CombinedOutput(); err != nil {
			return fmt.Errorf("vma extract failed: %v: %s", err, out)
		}
		return nil
	}

	pr, pw := io.Pipe()
	dec.Stdout = pw
	decErrBuf := &bytes.Buffer{}
	dec.Stderr = decErrBuf
	vma.Stdin = pr
	if err := dec.Start(); err != nil {
		return fmt.Errorf("failed to start %s: %w", decomp[0], err)
	}

	// Close the pipe writer once the decompressor exits so `vma` sees EOF.
	// Doing this in a goroutine avoids deadlocking when `vma` exits early
	// (e.g. bad magic) while the decompressor is still blocked writing.
	decDone := make(chan error, 1)
	go func() {
		err := dec.Wait()
		pw.Close()
		decDone <- err
	}()

	out, vmaErr := vma.CombinedOutput()
	pr.Close()
	waitErr := <-decDone

	if vmaErr != nil {
		if waitErr != nil && decErrBuf.Len() > 0 {
			return fmt.Errorf("vma extract failed: %v: %s (decompressor %s: %v: %s)",
				vmaErr, out, decomp[0], waitErr, strings.TrimSpace(decErrBuf.String()))
		}
		return fmt.Errorf("vma extract failed: %v: %s", vmaErr, out)
	}
	if waitErr != nil {
		return fmt.Errorf("decompressing %s failed: %v: %s",
			filepath.Base(path), waitErr, strings.TrimSpace(decErrBuf.String()))
	}
	return nil
}

// pveConfig holds the subset of a Proxmox config file we care about.
type pveConfig struct {
	Hostname   string
	BootDisk   string
	Bios       string
	Memory     int
	Cores      int
	RootfsSize string
}

func parsePVEConfig(path string) (*pveConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	cfg := &pveConfig{Hostname: "", Memory: 1024, Cores: 1}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		switch key {
		case "hostname":
			cfg.Hostname = val
		case "name":
			// qemu-server.conf uses "name:" where pct.conf uses "hostname:"
			if cfg.Hostname == "" {
				cfg.Hostname = val
			}
		case "bios":
			cfg.Bios = val
		case "boot":
			// boot: order=scsi0,ide2 — first device wins; only accept
			// device-style names (ending in a digit), not old "boot: c".
			val = strings.TrimPrefix(val, "order=")
			if i := strings.IndexByte(val, ','); i >= 0 {
				val = val[:i]
			}
			val = strings.TrimSpace(val)
			if n := len(val); n > 0 && val[n-1] >= '0' && val[n-1] <= '9' {
				cfg.BootDisk = val
			}
		case "memory":
			fmt.Sscanf(val, "%d", &cfg.Memory)
		case "cores":
			fmt.Sscanf(val, "%d", &cfg.Cores)
		case "rootfs":
			// rootfs: local-lvm:vm-100-disk-0,size=8G
			for _, part := range strings.Split(val, ",") {
				if strings.HasPrefix(part, "size=") {
					cfg.RootfsSize = strings.TrimPrefix(part, "size=")
				}
			}
		}
	}
	return cfg, nil
}

func extractArchive(path, dest string) error {
	var cmd *exec.Cmd
	switch {
	case strings.HasSuffix(path, ".tar.zst"):
		cmd = exec.Command("tar", "--zstd", "-xf", path, "-C", dest)
	case strings.HasSuffix(path, ".tar.gz"):
		cmd = exec.Command("tar", "-xzf", path, "-C", dest)
	case strings.HasSuffix(path, ".tar.xz"):
		cmd = exec.Command("tar", "-xJf", path, "-C", dest)
	case strings.HasSuffix(path, ".tar.lzo"):
		cmd = exec.Command("tar", "--lzop", "-xf", path, "-C", dest)
	default:
		return fmt.Errorf("unsupported archive format: %s", path)
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("extract failed: %v: %s", err, out)
	}
	return nil
}

// buildDomainXML builds libvirt domain XML for an imported VM. When
// ovmfCode+nvram are set the domain boots via OVMF (UEFI); otherwise via
// SeaBIOS with a boot-from-disk order.
func buildDomainXML(name string, memoryMB, cores int, diskPath, ovmfCode, nvram, machine string) string {
	osBlock := fmt.Sprintf("    <type arch='x86_64' machine='%s'>hvm</type>\n    <boot dev='hd'/>", machine)
	if ovmfCode != "" && nvram != "" {
		osBlock = fmt.Sprintf("    <type arch='x86_64' machine='%s'>hvm</type>\n"+
			"    <loader readonly='yes' type='pflash'>%s</loader>\n"+
			"    <nvram>%s</nvram>", machine, ovmfCode, nvram)
	}
	return fmt.Sprintf(`<domain type='kvm'>
  <name>%s</name>
  <memory unit='MiB'>%d</memory>
  <vcpu placement='static'>%d</vcpu>
  <os>
%s
  </os>
  <features><acpi/><apic/></features>
  <devices>
    <emulator>/usr/bin/kvm</emulator>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='%s'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <graphics type='vnc' port='-1' autoport='yes' listen='127.0.0.1'/>
    <video><model type='qxl'/></video>
  </devices>
</domain>`, name, memoryMB, cores, osBlock, diskPath)
}

// pickBootDisk selects which extracted image is the OS disk: a filename
// containing the config's boot disk device (e.g. "scsi0") if present,
// otherwise the largest image — tiny helper disks (efidisk0, 4M) must not
// be picked over the real OS disk.
func pickBootDisk(disks []string, bootDisk string) string {
	if bootDisk != "" {
		if d := findFileContains(disks, bootDisk); d != "" {
			return d
		}
	}
	best := ""
	var bestSize int64
	for _, d := range disks {
		if fi, err := os.Stat(d); err == nil && (best == "" || fi.Size() > bestSize) {
			best, bestSize = d, fi.Size()
		}
	}
	if best == "" {
		return disks[0]
	}
	return best
}

// findFileContains returns the first path whose base name contains substr.
func findFileContains(paths []string, substr string) string {
	for _, p := range paths {
		if strings.Contains(filepath.Base(p), substr) {
			return p
		}
	}
	return ""
}

// copyFile copies src to dst, creating/truncating dst.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

// ovmfCandidates lists (CODE, VARS) firmware pairs on common distro paths.
var ovmfCandidates = [][2]string{
	{"/usr/share/OVMF/OVMF_CODE_4M.fd", "/usr/share/OVMF/OVMF_VARS_4M.fd"},
	{"/usr/share/OVMF/OVMF_CODE.fd", "/usr/share/OVMF/OVMF_VARS.fd"},
	{"/usr/share/edk2/ovmf/OVMF_CODE.fd", "/usr/share/edk2/ovmf/OVMF_VARS.fd"},
	{"/usr/share/edk2/x64/OVMF_CODE.4m.fd", "/usr/share/edk2/x64/OVMF_VARS.4m.fd"},
}

// findOVMF locates OVMF firmware code + VARS template; empty if absent.
func findOVMF() (code, vars string) {
	for _, c := range ovmfCandidates {
		if _, err := os.Stat(c[0]); err == nil {
			if _, err := os.Stat(c[1]); err == nil {
				return c[0], c[1]
			}
		}
	}
	return "", ""
}

// latestQ35Machine returns the newest pc-q35-X.Y machine type reported by
// qemu-system-x86_64. Versioned machine types are deprecated and eventually
// removed (pc-q35-6.2 warns on current QEMU), so imports target the current
// one. Falls back to pc-q35-6.2 when detection is not possible.
func latestQ35Machine() string {
	out, err := exec.Command("qemu-system-x86_64", "-machine", "help").Output()
	if err != nil {
		return "pc-q35-6.2"
	}
	re := regexp.MustCompile(`^(pc-q35)-(\d+)\.(\d+)`)
	best := ""
	bestMajor, bestMinor := -1, -1
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		if m := re.FindStringSubmatch(fields[0]); m != nil {
			major, _ := strconv.Atoi(m[2])
			minor, _ := strconv.Atoi(m[3])
			if major > bestMajor || (major == bestMajor && minor > bestMinor) {
				bestMajor, bestMinor = major, minor
				best = fields[0]
			}
		}
	}
	if best == "" {
		return "pc-q35-6.2"
	}
	return best
}

// toLXDSize converts a Proxmox size string (e.g. "2G", "512M") to the
// format LXD expects for device sizes (e.g. "2GiB", "512MiB").
func toLXDSize(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	last := s[len(s)-1]
	switch last {
	case 'G', 'g':
		return s[:len(s)-1] + "GiB"
	case 'M', 'm':
		return s[:len(s)-1] + "MiB"
	case 'T', 't':
		return s[:len(s)-1] + "TiB"
	case 'K', 'k':
		return s[:len(s)-1] + "KiB"
	default:
		return s
	}
}
