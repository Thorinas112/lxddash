package libvirt

import (
	"context"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/digitalocean/go-libvirt"
	"github.com/digitalocean/go-libvirt/socket"
	"github.com/digitalocean/go-libvirt/socket/dialers"
)

// qemuUptime finds the QEMU process for the given domain name and
// returns how long it has been running. It scans /proc for a
// qemu-system process whose cmdline contains the domain name.
func qemuUptime(domainName string) time.Duration {
	if domainName == "" {
		return 0
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return 0
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(e.Name())
		if err != nil || pid <= 0 {
			continue
		}
		cmdline, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
		if err != nil {
			continue
		}
		cmd := strings.ReplaceAll(string(cmdline), "\x00", " ")
		// libvirt may invoke QEMU as qemu-system-x86_64 or as the Ubuntu
		// "kvm" alias (argv[0]=/usr/bin/kvm); both pass -name guest=<dom>.
		if strings.Contains(cmd, "-name guest="+domainName) {
			return processUptime(pid)
		}
		if strings.Contains(cmd, "qemu-system") && strings.Contains(cmd, domainName) {
			return processUptime(pid)
		}
	}
	return 0
}

// processUptime returns how long the process with the given PID has
// been running, from /proc/<pid>/stat start time.
func processUptime(pid int) time.Duration {
	if pid <= 0 {
		return 0
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	s := string(data)
	close := strings.LastIndexByte(s, ')')
	if close < 0 {
		return 0
	}
	rest := strings.Fields(s[close+1:])
	if len(rest) < 20 {
		return 0
	}
	startTicks, err := strconv.ParseUint(rest[19], 10, 64)
	if err != nil {
		return 0
	}
	startSec := float64(startTicks) / 100.0 // USER_HZ
	bt, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	bootSec := float64(0)
	for _, line := range strings.Split(string(bt), "\n") {
		if strings.HasPrefix(line, "btime ") {
			if v, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimPrefix(line, "btime ")), 64); err == nil {
				bootSec = v
			}
			break
		}
	}
	now := float64(time.Now().Unix())
	uptime := time.Duration((now - bootSec - startSec) * float64(time.Second))
	if uptime < 0 {
		return 0
	}
	return uptime
}

// Service wraps the go-libvirt client (QEMU/KVM over the libvirt daemon).
type Service struct {
	l          *libvirt.Libvirt
	vmImageDir string
	isoDir     string
}

func New(uri, vmImageDir, isoDir string) (*Service, error) {
	var d socket.Dialer
	switch {
	case strings.HasPrefix(uri, "qemu+tcp://"), strings.HasPrefix(uri, "qemu+ssh://"):
		host := strings.TrimPrefix(uri, "qemu+tcp://")
		host = strings.TrimPrefix(host, "qemu+ssh://")
		host = strings.TrimSuffix(host, "/system")
		d = dialers.NewRemote(host, dialers.WithRemoteTimeout(5*time.Second))
	default:
		d = dialers.NewLocal(dialers.WithLocalTimeout(5 * time.Second))
	}
	l := libvirt.NewWithDialer(d)
	if err := l.ConnectToURI(libvirt.ConnectURI(uri)); err != nil {
		return nil, err
	}
	return &Service{l: l, vmImageDir: vmImageDir, isoDir: isoDir}, nil
}

func (s *Service) Close() error {
	return s.l.Disconnect()
}

// IfaceInfo describes one virtual NIC of a domain.
type IfaceInfo struct {
	Name    string `json:"name"`
	MAC     string `json:"mac,omitempty"`
	Model   string `json:"model,omitempty"`
	Network string `json:"network,omitempty"` // managed network or bridge name
}

// DomainInfo is a summary of a libvirt domain (VM).
type DomainInfo struct {
	UUID       string      `json:"uuid"`
	Name       string      `json:"name"`
	State      string      `json:"state"`
	VCPUs      uint32      `json:"vcpus"`
	Memory     uint64      `json:"memory"` // MB
	VNC        int         `json:"vnc_port"`
	Autostart  bool        `json:"autostart"`
	ISO        string      `json:"iso,omitempty"` // currently attached CDROM ISO filename
	Interfaces []IfaceInfo `json:"interfaces,omitempty"`
	IP         string      `json:"ip,omitempty"` // IPv4 from DHCP lease (running VMs)
}

// DomainStat is a live resource snapshot for one VM.
type DomainStat struct {
	UUID       string  `json:"uuid"`
	Name       string  `json:"name"`
	State      string  `json:"state"`
	VCPUs      uint32  `json:"vcpus"`
	CPUTime    uint64  `json:"cpu_time"`  // nanoseconds of CPU time
	MemUsage   uint64  `json:"mem_usage"` // bytes currently used
	MemLimit   uint64  `json:"mem_limit"` // bytes configured (max)
	MemPercent float64 `json:"mem_percent"`
	Uptime     int64   `json:"uptime_seconds"`
}

// Stats returns live CPU/memory usage for all domains.
func (s *Service) Stats(ctx context.Context) ([]DomainStat, error) {
	domains, _, err := s.l.ConnectListAllDomains(1, 0)
	if err != nil {
		return nil, err
	}
	out := make([]DomainStat, 0, len(domains))
	for _, d := range domains {
		st, err := s.domainStat(ctx, d)
		if err != nil {
			continue
		}
		out = append(out, st)
	}
	return out, nil
}

// Stat returns live resource stats for a single domain.
func (s *Service) Stat(ctx context.Context, uuid string) (*DomainStat, error) {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return nil, err
	}
	st, err := s.domainStat(ctx, d)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

func (s *Service) domainStat(ctx context.Context, d libvirt.Domain) (DomainStat, error) {
	state, _, err := s.l.DomainGetState(d, 0)
	if err != nil {
		return DomainStat{}, err
	}
	// DomainGetInfo returns current memory (rMemory) and max memory
	// (rMaxMem) in KiB, plus CPU time in nanoseconds.
	rState, rMaxMem, rMemory, nrVirtCPU, cpuTime, err := s.l.DomainGetInfo(d)
	if err != nil {
		return DomainStat{}, err
	}
	_ = rState
	memLimit := rMaxMem * 1024
	memUsage := rMemory * 1024
	memPercent := 0.0
	if memLimit > 0 {
		memPercent = float64(memUsage) / float64(memLimit) * 100.0
	}
	return DomainStat{
		UUID:       formatUUID(d.UUID),
		Name:       d.Name,
		State:      stateString(libvirt.DomainState(state)),
		VCPUs:      uint32(nrVirtCPU),
		CPUTime:    cpuTime,
		MemUsage:   memUsage,
		MemLimit:   memLimit,
		MemPercent: memPercent,
		Uptime:     int64(qemuUptime(d.Name) / time.Second),
	}, nil
}

func (s *Service) Domains(ctx context.Context) ([]DomainInfo, error) {
	domains, _, err := s.l.ConnectListAllDomains(1, 0)
	if err != nil {
		return nil, err
	}
	out := make([]DomainInfo, 0, len(domains))
	for _, d := range domains {
		info, err := s.domainInfo(ctx, d)
		if err != nil {
			continue
		}
		out = append(out, info)
	}
	return out, nil
}

func (s *Service) Domain(ctx context.Context, uuid string) (DomainInfo, error) {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return DomainInfo{}, err
	}
	return s.domainInfo(ctx, d)
}

func (s *Service) domainInfo(ctx context.Context, d libvirt.Domain) (DomainInfo, error) {
	state, _, err := s.l.DomainGetState(d, 0)
	if err != nil {
		return DomainInfo{}, err
	}
	xmlDesc, err := s.l.DomainGetXMLDesc(d, 0)
	if err != nil {
		return DomainInfo{}, err
	}
	var domXML struct {
		UUID    string `xml:"uuid"`
		Memory  uint64 `xml:"memory"`
		VCPU    uint32 `xml:"vcpu"`
		Devices struct {
			Graphics []struct {
				Type string `xml:"type,attr"`
				Port int    `xml:"port,attr"`
			} `xml:"graphics"`
			Disks []struct {
				Device string `xml:"device,attr"`
				Source struct {
					File string `xml:"file,attr"`
				} `xml:"source"`
			} `xml:"disk"`
			Interfaces []struct {
				MAC struct {
					Address string `xml:"address,attr"`
				} `xml:"mac"`
				Model struct {
					Type string `xml:"type,attr"`
				} `xml:"model"`
				Source struct {
					Network string `xml:"network,attr"`
					Bridge  string `xml:"bridge,attr"`
				} `xml:"source"`
				Target struct {
					Dev string `xml:"dev,attr"`
				} `xml:"target"`
			} `xml:"interface"`
		} `xml:"devices"`
	}
	if err := xml.Unmarshal([]byte(xmlDesc), &domXML); err != nil {
		return DomainInfo{}, err
	}
	vnc := 0
	for _, g := range domXML.Devices.Graphics {
		if g.Type == "vnc" {
			vnc = g.Port
		}
	}
	// Find attached ISO (cdrom device).
	iso := ""
	for _, dk := range domXML.Devices.Disks {
		if dk.Device == "cdrom" && dk.Source.File != "" {
			iso = filepath.Base(dk.Source.File)
			break
		}
	}
	autostart, err := s.l.DomainGetAutostart(d)
	if err != nil {
		autostart = 0
	}
	// Network interfaces from the domain config (MAC/model/bridge are
	// static config — known even when the VM is stopped).
	ifaces := make([]IfaceInfo, 0, len(domXML.Devices.Interfaces))
	for i, iface := range domXML.Devices.Interfaces {
		name := iface.Target.Dev
		if name == "" {
			name = fmt.Sprintf("iface%d", i)
		}
		network := iface.Source.Network
		if network == "" {
			network = iface.Source.Bridge
		}
		ifaces = append(ifaces, IfaceInfo{
			Name:    name,
			MAC:     iface.MAC.Address,
			Model:   iface.Model.Type,
			Network: network,
		})
	}
	// Best-effort IPv4 from the libvirt DHCP lease table (running VMs only).
	ip := ""
	if stateString(libvirt.DomainState(state)) == "running" {
		if addr, err := s.IPAddress(ctx, domXML.UUID); err == nil {
			ip = addr
		}
	}
	return DomainInfo{
		UUID:       domXML.UUID,
		Name:       d.Name,
		State:      stateString(libvirt.DomainState(state)),
		VCPUs:      domXML.VCPU,
		Memory:     domXML.Memory / 1024, // libvirt XML memory is KiB; expose MB (frontend fmtMem expects MB)
		VNC:        vnc,
		Autostart:  autostart == 1,
		ISO:        iso,
		Interfaces: ifaces,
		IP:         ip,
	}, nil
}

func (s *Service) Start(ctx context.Context, uuid string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	return s.l.DomainCreate(d)
}

func (s *Service) Shutdown(ctx context.Context, uuid string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	return s.l.DomainShutdown(d)
}

func (s *Service) Reboot(ctx context.Context, uuid string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	return s.l.DomainReboot(d, 0)
}

func (s *Service) ForceStop(ctx context.Context, uuid string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	return s.l.DomainDestroy(d)
}

func (s *Service) Delete(ctx context.Context, uuid string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	state, _, err := s.l.DomainGetState(d, 0)
	if err != nil {
		return err
	}
	if libvirt.DomainState(state) == libvirt.DomainRunning {
		if err := s.l.DomainDestroy(d); err != nil {
			return err
		}
	}
	return s.l.DomainUndefine(d)
}

// SnapshotInfo describes a VM snapshot.
type SnapshotInfo struct {
	Name    string `json:"name"`
	Created string `json:"created,omitempty"`
	State   string `json:"state,omitempty"`
	Current bool   `json:"current"`
	HasMeta bool   `json:"has_metadata"`
}

// Snapshots lists all snapshots of a VM.
func (s *Service) Snapshots(ctx context.Context, uuid string) ([]SnapshotInfo, error) {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return nil, err
	}
	names, err := s.l.DomainSnapshotListNames(d, 0, 0)
	if err != nil {
		return nil, err
	}
	cur, err := s.l.DomainSnapshotCurrent(d, 0)
	curName := ""
	if err == nil {
		if x, err2 := s.l.DomainSnapshotGetXMLDesc(cur, 0); err2 == nil {
			var snapXML struct {
				Name string `xml:"name"`
			}
			if xml.Unmarshal([]byte(x), &snapXML) == nil {
				curName = snapXML.Name
			}
		}
	}
	out := make([]SnapshotInfo, 0, len(names))
	for _, n := range names {
		info := SnapshotInfo{Name: n, Current: n == curName}
		snap, err := s.l.DomainSnapshotLookupByName(d, n, 0)
		if err != nil {
			out = append(out, info)
			continue
		}
		if x, err := s.l.DomainSnapshotGetXMLDesc(snap, 0); err == nil {
			var snapXML struct {
				Name        string `xml:"name"`
				State       string `xml:"state"`
				Description string `xml:"description"`
				Creation    string `xml:"creationTime"`
			}
			if xml.Unmarshal([]byte(x), &snapXML) == nil {
				info.State = snapXML.State
				info.Created = snapXML.Creation
			}
		}
		if m, err := s.l.DomainSnapshotHasMetadata(snap, 0); err == nil {
			info.HasMeta = m == 1
		}
		out = append(out, info)
	}
	return out, nil
}

// CreateSnapshot takes a snapshot of a VM.
func (s *Service) CreateSnapshot(ctx context.Context, uuid, name string) error {
	if name == "" {
		return fmt.Errorf("snapshot name is required")
	}
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	xml := fmt.Sprintf("<domainsnapshot><name>%s</name></domainsnapshot>", name)
	_, err = s.l.DomainSnapshotCreateXML(d, xml, 0)
	return err
}

// RevertSnapshot restores a VM to a snapshot. go-libvirt has no
// snapshot-revert RPC, so we shell out to virsh.
func (s *Service) RevertSnapshot(ctx context.Context, uuid, name string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	if _, err := exec.LookPath("virsh"); err != nil {
		return fmt.Errorf("virsh is required to revert snapshots")
	}
	cmd := exec.CommandContext(ctx, "virsh", "snapshot-revert", d.Name, name)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("snapshot-revert failed: %v: %s", err, out)
	}
	return nil
}

// DeleteSnapshot removes a snapshot from a VM.
func (s *Service) DeleteSnapshot(ctx context.Context, uuid, name string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	snap, err := s.l.DomainSnapshotLookupByName(d, name, 0)
	if err != nil {
		return err
	}
	return s.l.DomainSnapshotDelete(snap, 0)
}

// SetAutostart enables or disables starting the VM on host boot.
func (s *Service) SetAutostart(ctx context.Context, uuid string, enabled bool) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	v := int32(0)
	if enabled {
		v = 1
	}
	return s.l.DomainSetAutostart(d, v)
}

// ResizeRequest describes a VM resource change.
type ResizeRequest struct {
	VCPUs    *uint32 `json:"vcpus,omitempty"`
	MemoryMB *uint64 `json:"memory_mb,omitempty"`
}

// Resize changes the vCPU count and/or memory of a VM. Applies to the
// live domain when running and persists to the config.
func (s *Service) Resize(ctx context.Context, uuid string, req ResizeRequest) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}
	state, _, err := s.l.DomainGetState(d, 0)
	if err != nil {
		return err
	}
	running := libvirt.DomainState(state) == libvirt.DomainRunning

	if req.VCPUs != nil && *req.VCPUs > 0 {
		flags := libvirt.DomainVCPUConfig
		if running {
			flags |= libvirt.DomainVCPULive
		}
		if err := s.l.DomainSetVcpusFlags(d, *req.VCPUs, uint32(flags)); err != nil {
			return fmt.Errorf("set vcpus: %w", err)
		}
	}
	if req.MemoryMB != nil && *req.MemoryMB > 0 {
		flags := libvirt.DomainMemConfig
		if running {
			flags |= libvirt.DomainMemLive
		}
		// Set the current memory first, then the maximum.
		if err := s.l.DomainSetMemoryFlags(d, *req.MemoryMB*1024, uint32(flags)); err != nil {
			return fmt.Errorf("set memory: %w", err)
		}
		if err := s.l.DomainSetMemoryFlags(d, *req.MemoryMB*1024, uint32(flags|libvirt.DomainMemMaximum)); err != nil {
			return fmt.Errorf("set max memory: %w", err)
		}
	}
	return nil
}

// VNCPort returns the VNC display port of a domain (0 if none).
func (s *Service) VNCPort(ctx context.Context, uuid string) (int, error) {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return 0, err
	}
	info, err := s.domainInfo(ctx, d)
	if err != nil {
		return 0, err
	}
	if info.VNC == 0 {
		return 0, fmt.Errorf("VM has no VNC display configured")
	}
	return info.VNC, nil
}

// ConsoleName returns the domain name for a VM UUID (used by the
// serial console which shells out to `virsh console`).
func (s *Service) ConsoleName(ctx context.Context, uuid string) (string, error) {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return "", err
	}
	return d.Name, nil
}

// IPAddress returns the VM's IPv4 address from the libvirt DHCP lease
// table (works on NAT networks without a guest agent). Empty error when
// the VM is stopped or has no lease.
func (s *Service) IPAddress(ctx context.Context, uuid string) (string, error) {
	name, err := s.ConsoleName(ctx, uuid)
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, "virsh", "domifaddr", name, "--source", "lease")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("virsh domifaddr: %v: %s", err, strings.TrimSpace(string(out)))
	}
	// Example row: vnet0  52:54:00:13:28:e5  ipv4  192.168.122.157/24
	re := regexp.MustCompile(`\b(\d{1,3}(?:\.\d{1,3}){3})/\d+\b`)
	if m := re.FindStringSubmatch(string(out)); m != nil {
		return m[1], nil
	}
	return "", fmt.Errorf("no DHCP lease found for %s (is the VM running?)", name)
}

// DefineXML defines a new domain from XML (used by Proxmox VM imports).
func (s *Service) DefineXML(xml string) error {
	_, err := s.l.DomainDefineXML(xml)
	return err
}

// CreateRequest describes a new KVM/QEMU VM.
type CreateRequest struct {
	Name     string `json:"name"`
	MemoryMB int    `json:"memory_mb"`
	VCPUs    int    `json:"vcpus"`
	DiskGB   int    `json:"disk_gb"`
	ISO      string `json:"iso"` // filename in the ISO dir (optional)
}

// CreateVM creates a qcow2 disk, defines the domain in libvirt and returns
// the new domain's UUID. Requires qemu-img on the host.
func (s *Service) CreateVM(ctx context.Context, req CreateRequest) (string, error) {
	if req.Name == "" {
		return "", fmt.Errorf("name is required")
	}
	if req.MemoryMB <= 0 {
		req.MemoryMB = 1024
	}
	if req.VCPUs <= 0 {
		req.VCPUs = 1
	}
	if req.DiskGB <= 0 {
		req.DiskGB = 20
	}

	if _, err := exec.LookPath("qemu-img"); err != nil {
		return "", fmt.Errorf("qemu-img is required to create VMs (apt install qemu-utils)")
	}

	if err := os.MkdirAll(s.vmImageDir, 0o755); err != nil {
		return "", err
	}
	diskPath := filepath.Join(s.vmImageDir, req.Name+".qcow2")
	if _, err := os.Stat(diskPath); err == nil {
		return "", fmt.Errorf("disk image %s already exists", diskPath)
	}

	// Create the qcow2 disk.
	cmd := exec.CommandContext(ctx, "qemu-img", "create", "-f", "qcow2", diskPath, fmt.Sprintf("%dG", req.DiskGB))
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("qemu-img create failed: %v: %s", err, out)
	}

	// Build the domain XML.
	xml := s.buildDomainXML(req, diskPath)
	if _, err := s.l.DomainDefineXML(xml); err != nil {
		_ = os.Remove(diskPath)
		return "", fmt.Errorf("define domain: %w", err)
	}

	d, err := s.l.DomainLookupByName(req.Name)
	if err != nil {
		return "", err
	}
	return formatUUID(d.UUID), nil
}

// CloneVM clones an existing VM: copies its disk (qcow2 backing file) and
// defines a new domain with a fresh name and UUID.
func (s *Service) CloneVM(ctx context.Context, uuid, newName string) (string, error) {
	if newName == "" {
		return "", fmt.Errorf("new name is required")
	}
	src, err := s.domainByUUID(uuid)
	if err != nil {
		return "", err
	}
	xmlDesc, err := s.l.DomainGetXMLDesc(src, 0)
	if err != nil {
		return "", err
	}

	// Parse the source XML to find its disk path.
	var domXML struct {
		Name    string `xml:"name"`
		Devices struct {
			Disks []struct {
				Source struct {
					File string `xml:"file,attr"`
				} `xml:"source"`
			} `xml:"disk"`
		} `xml:"devices"`
	}
	if err := xml.Unmarshal([]byte(xmlDesc), &domXML); err != nil {
		return "", err
	}
	srcDisk := ""
	for _, d := range domXML.Devices.Disks {
		if d.Source.File != "" && strings.HasSuffix(d.Source.File, ".qcow2") {
			srcDisk = d.Source.File
			break
		}
	}
	if srcDisk == "" {
		return "", fmt.Errorf("source VM has no qcow2 disk to clone")
	}

	if _, err := exec.LookPath("qemu-img"); err != nil {
		return "", fmt.Errorf("qemu-img is required to clone VMs (apt install qemu-utils)")
	}
	if err := os.MkdirAll(s.vmImageDir, 0o755); err != nil {
		return "", err
	}
	newDisk := filepath.Join(s.vmImageDir, newName+".qcow2")
	if _, err := os.Stat(newDisk); err == nil {
		return "", fmt.Errorf("disk image %s already exists", newDisk)
	}

	// Create a copy-on-write clone backed by the source disk.
	cmd := exec.CommandContext(ctx, "qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", srcDisk, newDisk)
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("qemu-img clone failed: %v: %s", err, out)
	}

	// Rewrite the XML: new name, new UUID, new disk path.
	repl := strings.Replace(xmlDesc, "<name>"+domXML.Name+"</name>", "<name>"+newName+"</name>", 1)
	repl = strings.Replace(repl, srcDisk, newDisk, 1)
	repl = strings.Replace(repl, "<uuid>"+formatUUID(src.UUID)+"</uuid>", "", 1)

	if _, err := s.l.DomainDefineXML(repl); err != nil {
		_ = os.Remove(newDisk)
		return "", fmt.Errorf("define clone: %w", err)
	}
	d, err := s.l.DomainLookupByName(newName)
	if err != nil {
		return "", err
	}
	return formatUUID(d.UUID), nil
}

// formatUUID renders a libvirt UUID ([16]byte) as a canonical UUID string.
func formatUUID(u [16]byte) string {
	s := hex.EncodeToString(u[:])
	return s[0:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
}

func (s *Service) buildDomainXML(req CreateRequest, diskPath string) string {
	var cdrom string
	if req.ISO != "" {
		isoPath := filepath.Join(s.isoDir, filepath.Base(req.ISO))
		cdrom = fmt.Sprintf(`
    <disk type='file' device='cdrom'>
      <driver name='qemu' type='raw'/>
      <source file='%s'/>
      <target dev='sda' bus='sata'/>
      <readonly/>
    </disk>`, isoPath)
	}
	return fmt.Sprintf(`<domain type='kvm'>
  <name>%s</name>
  <memory unit='MiB'>%d</memory>
  <vcpu placement='static'>%d</vcpu>
  <os>
    <type arch='x86_64' machine='pc-q35-6.2'>hvm</type>
    <boot dev='hd'/>
    <boot dev='cdrom'/>
  </os>
  <features><acpi/><apic/></features>
  <devices>
    <emulator>/usr/bin/kvm</emulator>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2'/>
      <source file='%s'/>
      <target dev='vda' bus='virtio'/>
    </disk>%s
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <graphics type='vnc' port='-1' autoport='yes' listen='127.0.0.1'/>
    <video><model type='qxl'/></video>
  </devices>
</domain>`, req.Name, req.MemoryMB, req.VCPUs, diskPath, cdrom)
}

// ISO describes an install ISO available on the host.
type ISO struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// ListISOs returns the ISO files in the configured ISO directory.
func (s *Service) ListISOs() ([]ISO, error) {
	entries, err := os.ReadDir(s.isoDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ISO{}, nil
		}
		return nil, err
	}
	out := []ISO{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(strings.ToLower(name), ".iso") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		out = append(out, ISO{Name: name, Size: info.Size()})
	}
	return out, nil
}

// ISOPath returns the absolute path of an ISO in the ISO dir.
func (s *Service) ISOPath(name string) string {
	return filepath.Join(s.isoDir, filepath.Base(name))
}

// AttachISO attaches (or replaces) a CDROM ISO on a running VM.
// It gets the current domain XML, adds/modifies the cdrom device, and
// re-defines the domain. The VM must be shut down first.
func (s *Service) AttachISO(ctx context.Context, uuid string, isoName string) error {
	d, err := s.domainByUUID(uuid)
	if err != nil {
		return err
	}

	// Get current XML.
	xmlDesc, err := s.l.DomainGetXMLDesc(d, 0)
	if err != nil {
		return fmt.Errorf("get domain XML: %w", err)
	}

	// Parse and modify.
	var domXML struct {
		Name    string `xml:"name"`
		Devices struct {
			Disks []struct {
				Type   string `xml:"type,attr"`
				Device string `xml:"device,attr"`
				Source struct {
					File string `xml:"file,attr"`
				} `xml:"source"`
				Target struct {
					Dev string `xml:"dev,attr"`
					Bus string `xml:"bus,attr"`
				} `xml:"target"`
			} `xml:"disk"`
		} `xml:"devices"`
	}
	if err := xml.Unmarshal([]byte(xmlDesc), &domXML); err != nil {
		return fmt.Errorf("parse domain XML: %w", err)
	}

	// Remove existing cdrom devices.
	newDisks := make([]struct {
		Type   string `xml:"type,attr"`
		Device string `xml:"device,attr"`
		Source struct {
			File string `xml:"file,attr"`
		} `xml:"source"`
		Target struct {
			Dev string `xml:"dev,attr"`
			Bus string `xml:"bus,attr"`
		} `xml:"target"`
	}, 0)
	for _, dk := range domXML.Devices.Disks {
		if dk.Device == "cdrom" {
			continue
		}
		newDisks = append(newDisks, dk)
	}

	// Add new cdrom if isoName is not empty.
	if isoName != "" {
		isoPath := filepath.Join(s.isoDir, filepath.Base(isoName))
		cdrom := struct {
			Type   string `xml:"type,attr"`
			Device string `xml:"device,attr"`
			Source struct {
				File string `xml:"file,attr"`
			} `xml:"source"`
			Target struct {
				Dev string `xml:"dev,attr"`
				Bus string `xml:"bus,attr"`
			} `xml:"target"`
		}{
			Type:   "file",
			Device: "cdrom",
		}
		cdrom.Source.File = isoPath
		cdrom.Target.Dev = "sda"
		cdrom.Target.Bus = "sata"
		newDisks = append(newDisks, cdrom)
	}

	// Rebuild the XML by doing string replacement — find the <devices> block
	// and replace disk elements. This is fragile but simpler than full XML rebuild.
	// First detach any existing cdrom to avoid "target already exists" errors.
	for _, dk := range domXML.Devices.Disks {
		if dk.Device == "cdrom" {
			detachArgs := []string{"detach-disk", domXML.Name, dk.Target.Dev, "--persistent"}
			cmd := exec.CommandContext(ctx, "virsh", detachArgs...)
			_, _ = cmd.CombinedOutput() // ignore errors — device may not exist
			break
		}
	}

	// Now attach or detach.
	args := []string{}
	if isoName != "" {
		isoPath := filepath.Join(s.isoDir, filepath.Base(isoName))
		args = []string{"attach-disk", domXML.Name, isoPath, "sda", "--type", "cdrom", "--mode", "readonly", "--persistent"}
	} else {
		return nil // already detached above
	}

	cmd := exec.CommandContext(ctx, "virsh", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("virsh %s failed: %v: %s", args[0], err, out)
	}
	return nil
}

func (s *Service) domainByUUID(uuid string) (libvirt.Domain, error) {
	u, err := parseUUID(uuid)
	if err != nil {
		return libvirt.Domain{}, err
	}
	return s.l.DomainLookupByUUID(u)
}

func parseUUID(s string) ([16]byte, error) {
	var u [16]byte
	hexStr := strings.ReplaceAll(s, "-", "")
	if len(hexStr) != 32 {
		return u, fmt.Errorf("invalid uuid %q", s)
	}
	b, err := hex.DecodeString(hexStr)
	if err != nil {
		return u, err
	}
	copy(u[:], b)
	return u, nil
}

func stateString(s libvirt.DomainState) string {
	switch s {
	case libvirt.DomainRunning:
		return "running"
	case libvirt.DomainShutoff:
		return "stopped"
	case libvirt.DomainShutdown:
		return "shutting-down"
	case libvirt.DomainPaused:
		return "paused"
	case libvirt.DomainCrashed:
		return "crashed"
	case libvirt.DomainBlocked:
		return "blocked"
	default:
		return "unknown"
	}
}
