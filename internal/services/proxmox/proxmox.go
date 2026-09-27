package proxmox

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
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
	Status    string    `json:"status"` // running | done | failed
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

	s.update(task, "extracting backup archive")
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

	s.update(task, fmt.Sprintf("creating LXD container %q", name))
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
	s.update(task, "starting container to mount rootfs")
	if err := s.lxd.SetState(ctx, name, "start"); err != nil {
		return fmt.Errorf("start instance: %w", err)
	}

	s.update(task, "copying rootfs into container (this can take a while)")
	cmd := exec.CommandContext(ctx, "lxc", "file", "push", "-r", rootfsDir+"/.", name+"/")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("rootfs copy failed: %v: %s", err, out)
	}

	s.update(task, "container imported successfully")
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
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(dir)

	s.update(task, "extracting VMA archive")
	cmd := exec.CommandContext(ctx, "vma", "extract", path, dir)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("vma extract failed: %v: %s", err, out)
	}

	disks, err := filepath.Glob(filepath.Join(dir, "*.img"))
	if err != nil || len(disks) == 0 {
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

	s.update(task, "converting disk image to qcow2")
	cmd = exec.CommandContext(ctx, "qemu-img", "convert", "-O", "qcow2", disks[0], qcow)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("qemu-img convert failed: %v: %s", err, out)
	}

	s.update(task, "defining VM in libvirt")
	xml := buildDomainXML(name, cfg.Memory, cfg.Cores, qcow)
	if err := s.libvirt.DefineXML(xml); err != nil {
		return fmt.Errorf("define domain: %w", err)
	}

	s.update(task, "VM imported successfully")
	return nil
}

// pveConfig holds the subset of a Proxmox config file we care about.
type pveConfig struct {
	Hostname   string
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

func buildDomainXML(name string, memoryMB, cores int, diskPath string) string {
	return fmt.Sprintf(`<domain type='kvm'>
  <name>%s</name>
  <memory unit='MiB'>%d</memory>
  <vcpu placement='static'>%d</vcpu>
  <os>
    <type arch='x86_64' machine='pc-q35-6.2'>hvm</type>
    <boot dev='hd'/>
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
</domain>`, name, memoryMB, cores, diskPath)
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