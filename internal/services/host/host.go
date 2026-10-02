package host

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	ghost "github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

// NetIface is a per-interface network counter snapshot.
type NetIface struct {
	Name string `json:"name"`
	Rx   uint64 `json:"rx"`
	Tx   uint64 `json:"tx"`
}

// GPUInfo is a snapshot of one GPU's usage (from nvidia-smi).
type GPUInfo struct {
	Name        string  `json:"name"`
	UtilPercent float64 `json:"util_percent"`
	MemUsed     uint64  `json:"mem_used"`
	MemTotal    uint64  `json:"mem_total"`
	TempC       int     `json:"temp_c"`
}

// Stats is a snapshot of the host's resource usage.
type Stats struct {
	Hostname    string     `json:"hostname"`
	OS          string     `json:"os"`
	Platform    string     `json:"platform"`
	Kernel      string     `json:"kernel"`
	Uptime      uint64     `json:"uptime"`
	CPUPercent  float64    `json:"cpu_percent"`
	CPUCores    int        `json:"cpu_cores"`
	MemTotal    uint64     `json:"mem_total"`
	MemUsed     uint64     `json:"mem_used"`
	MemPercent  float64    `json:"mem_percent"`
	SwapTotal   uint64     `json:"swap_total"`
	SwapUsed    uint64     `json:"swap_used"`
	DiskTotal   uint64     `json:"disk_total"`
	DiskUsed    uint64     `json:"disk_used"`
	DiskPercent float64    `json:"disk_percent"`
	NetRx       uint64     `json:"net_rx"`
	NetTx       uint64     `json:"net_tx"`
	NetIfaces   []NetIface `json:"net_ifaces"`
	GPUs        []GPUInfo  `json:"gpus"`
	Timestamp   time.Time  `json:"timestamp"`
}

type Service struct{}

func New() *Service { return &Service{} }

// LanInfo describes the LAN-facing network for macvlan setups: the
// default-route interface, its CIDR/host address, and the gateway —
// used so containers/VMs can take IPs from the router's DHCP.
type LanInfo struct {
	Parent  string   `json:"parent"`
	CIDR    string   `json:"cidr"`
	Addr    string   `json:"addr"`
	Gateway string   `json:"gateway"`
	Ifaces  []string `json:"ifaces"`
}

// LanInfo detects the LAN interface (default route) via ip(8).
func (s *Service) LanInfo() (*LanInfo, error) {
	out, err := exec.Command("ip", "-j", "route", "show", "default").Output()
	if err != nil {
		return nil, fmt.Errorf("detect default route: %w", err)
	}
	var routes []struct {
		Gateway string `json:"gateway"`
		Dev     string `json:"dev"`
	}
	if err := json.Unmarshal(out, &routes); err != nil || len(routes) == 0 {
		return nil, fmt.Errorf("no default route found")
	}
	info := &LanInfo{Parent: routes[0].Dev, Gateway: routes[0].Gateway}

	if adj, err := exec.Command("ip", "-j", "addr", "show").Output(); err == nil {
		var ifaces []struct {
			IfName   string `json:"ifname"`
			AddrInfo []struct {
				Family    string `json:"family"`
				Local     string `json:"local"`
				PrefixLen int    `json:"prefixlen"`
			} `json:"addr_info"`
		}
		if json.Unmarshal(adj, &ifaces) == nil {
			for _, iface := range ifaces {
				if iface.IfName == "lo" || strings.HasPrefix(iface.IfName, "veth") ||
					strings.HasPrefix(iface.IfName, "br-") || strings.HasPrefix(iface.IfName, "lxdbr") ||
					strings.HasPrefix(iface.IfName, "virbr") || strings.HasPrefix(iface.IfName, "docker") {
					continue
				}
				info.Ifaces = append(info.Ifaces, iface.IfName)
				if iface.IfName == info.Parent {
					for _, a := range iface.AddrInfo {
						if a.Family == "inet" && a.Local != "" {
							info.Addr = a.Local
							info.CIDR = networkCIDR(a.Local, a.PrefixLen)
						}
					}
				}
			}
		}
	}
	return info, nil
}

// networkCIDR computes the IPv4 network address for an address + prefix.
func networkCIDR(addr string, prefix int) string {
	parts := strings.Split(addr, ".")
	if len(parts) != 4 || prefix < 0 || prefix > 32 {
		return fmt.Sprintf("%s/%d", addr, prefix)
	}
	var ip uint32
	for _, p := range parts {
		v, _ := strconv.Atoi(p)
		ip = ip<<8 | uint32(v&0xff)
	}
	mask := ^uint32(0) << (32 - uint(prefix))
	net := ip & mask
	return fmt.Sprintf("%d.%d.%d.%d/%d", byte(net>>24), byte(net>>16), byte(net>>8), byte(net), prefix)
}

// Stats gathers host metrics from /proc via gopsutil.
func (s *Service) Stats(ctx context.Context) (*Stats, error) {
	st := &Stats{Timestamp: time.Now()}

	if hi, err := ghost.InfoWithContext(ctx); err == nil {
		st.Hostname = hi.Hostname
		st.OS = hi.OS
		st.Platform = hi.Platform
		st.Kernel = hi.KernelVersion
		st.Uptime = hi.Uptime
	}

	if p, err := cpu.PercentWithContext(ctx, 0, false); err == nil && len(p) > 0 {
		st.CPUPercent = p[0]
	}
	if n, err := cpu.CountsWithContext(ctx, false); err == nil {
		st.CPUCores = n
	}

	if vm, err := mem.VirtualMemoryWithContext(ctx); err == nil {
		st.MemTotal = vm.Total
		st.MemUsed = vm.Used
		st.MemPercent = vm.UsedPercent
	}
	if sw, err := mem.SwapMemoryWithContext(ctx); err == nil {
		st.SwapTotal = sw.Total
		st.SwapUsed = sw.Used
	}

	if du, err := disk.UsageWithContext(ctx, "/"); err == nil {
		st.DiskTotal = du.Total
		st.DiskUsed = du.Used
		st.DiskPercent = du.UsedPercent
	}

	if nio, err := net.IOCountersWithContext(ctx, false); err == nil && len(nio) > 0 {
		st.NetRx = nio[0].BytesRecv
		st.NetTx = nio[0].BytesSent
	}
	if perIface, err := net.IOCountersWithContext(ctx, true); err == nil {
		for _, ni := range perIface {
			// Skip loopback and virtual interfaces.
			if ni.Name == "lo" || strings.HasPrefix(ni.Name, "veth") || strings.HasPrefix(ni.Name, "virbr") {
				continue
			}
			st.NetIfaces = append(st.NetIfaces, NetIface{Name: ni.Name, Rx: ni.BytesRecv, Tx: ni.BytesSent})
		}
	}

	st.GPUs = gpuStats(ctx)

	return st, nil
}

// gpuStats queries nvidia-smi for per-GPU utilization, memory and
// temperature. Returns nil when no NVIDIA GPU / nvidia-smi is present.
func gpuStats(ctx context.Context) []GPUInfo {
	if _, err := exec.LookPath("nvidia-smi"); err != nil {
		return nil
	}
	ctx2, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx2, "nvidia-smi",
		"--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
		"--format=csv,noheader,nounits").CombinedOutput()
	if err != nil {
		return nil
	}
	var gpus []GPUInfo
	for _, ln := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		parts := strings.Split(ln, ",")
		if len(parts) < 5 {
			continue
		}
		// The name may itself contain commas, so parse the 4 numeric
		// fields from the end and treat the rest as the name.
		util, err1 := strconv.ParseFloat(strings.TrimSpace(parts[len(parts)-4]), 64)
		memUsed, err2 := strconv.ParseUint(strings.TrimSpace(parts[len(parts)-3]), 10, 64)
		memTotal, err3 := strconv.ParseUint(strings.TrimSpace(parts[len(parts)-2]), 10, 64)
		temp, err4 := strconv.Atoi(strings.TrimSpace(parts[len(parts)-1]))
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			continue
		}
		gpus = append(gpus, GPUInfo{
			Name:        strings.TrimSpace(strings.Join(parts[:len(parts)-4], ",")),
			UtilPercent: util,
			MemUsed:     memUsed * 1024 * 1024, // MiB -> bytes
			MemTotal:    memTotal * 1024 * 1024,
			TempC:       temp,
		})
	}
	return gpus
}

// ProcessStats is a snapshot of a single process's resource usage.
type ProcessStats struct {
	CPU    float64 `json:"cpu_percent"`
	Memory uint64  `json:"memory_bytes"`
}

// ProcessStats returns CPU/memory usage of the first process matching
// the given name (e.g. "ollama").
func (s *Service) ProcessStats(name string) (ProcessStats, bool) {
	procs, err := process.Processes()
	if err != nil {
		return ProcessStats{}, false
	}
	for _, p := range procs {
		pname, err := p.Name()
		if err != nil {
			continue
		}
		if pname == name {
			cpuPct, _ := p.CPUPercent()
			memInfo, _ := p.MemoryInfo()
			var memBytes uint64
			if memInfo != nil {
				memBytes = memInfo.RSS
			}
			return ProcessStats{CPU: cpuPct, Memory: memBytes}, true
		}
	}
	return ProcessStats{}, false
}

// ProcessUptime returns how long the process with the given PID has
// been running, computed from /proc/<pid>/stat start time. Returns 0
// if the process is gone or unreadable.
func ProcessUptime(pid int) time.Duration {
	if pid <= 0 {
		return 0
	}
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	// The comm field (in parens) can contain spaces, so find the last
	// ')' and parse fields after it. Field 22 (index 21) is starttime
	// in clock ticks since boot.
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
	ticksPerSec := float64(100) // USER_HZ, standard on Linux
	startSec := float64(startTicks) / ticksPerSec
	// Boot time in unix seconds.
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

// MountUsage is disk usage for a single mount point.
type MountUsage struct {
	Mount     string  `json:"mount"`
	Device    string  `json:"device"`
	Fstype    string  `json:"fstype"`
	Total     uint64  `json:"total"`
	Used      uint64  `json:"used"`
	Free      uint64  `json:"free"`
	Percent   float64 `json:"percent"`
	InodesPct float64 `json:"inodes_percent"`
}

// DiskInfo describes a physical disk and its SMART health.
type DiskInfo struct {
	Name       string `json:"name"`
	Model      string `json:"model"`
	Size       uint64 `json:"size"`
	Type       string `json:"type"` // "ssd" | "hdd" | "nvme" | "unknown"
	Health     string `json:"health"` // "PASSED" | "FAILED" | "unknown"
	TempC      int    `json:"temp_c"`
	ReadErrors uint64 `json:"read_errors"`
}

// Disks returns per-mount usage and physical disk SMART health.
func (s *Service) Disks(ctx context.Context) (mounts []MountUsage, disks []DiskInfo, err error) {
	parts, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		return nil, nil, err
	}
	seen := map[string]bool{}
	for _, p := range parts {
		// Skip virtual/overlay filesystems.
		switch p.Fstype {
		case "squashfs", "overlay", "tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "devpts", "mqueue", "hugetlbfs", "binfmt_misc", "fusectl", "configfs", "debugfs", "tracefs", "securityfs", "pstore", "autofs", "ramfs", "efivarfs", "bpf":
			continue
		}
		if seen[p.Mountpoint] {
			continue
		}
		seen[p.Mountpoint] = true
		u, err := disk.UsageWithContext(ctx, p.Mountpoint)
		if err != nil {
			continue
		}
		m := MountUsage{
			Mount:   p.Mountpoint,
			Device:  p.Device,
			Fstype:  p.Fstype,
			Total:   u.Total,
			Used:    u.Used,
			Free:    u.Free,
			Percent: u.UsedPercent,
		}
		if u.InodesTotal > 0 {
			m.InodesPct = float64(u.InodesUsed) / float64(u.InodesTotal) * 100
		}
		mounts = append(mounts, m)
	}

	// Physical disks via /sys/block (works without smartctl).
	entries, err := os.ReadDir("/sys/block")
	if err != nil {
		return mounts, disks, nil
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "zram") {
			continue
		}
		info := DiskInfo{Name: name, Health: "unknown", TempC: -1}
		if b, err := os.ReadFile("/sys/block/" + name + "/size"); err == nil {
			sectors, _ := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
			info.Size = sectors * 512
		}
		if b, err := os.ReadFile("/sys/block/" + name + "/device/model"); err == nil {
			info.Model = strings.TrimSpace(string(b))
		}
		if b, err := os.ReadFile("/sys/block/" + name + "/queue/rotational"); err == nil {
			if strings.TrimSpace(string(b)) == "0" {
				info.Type = "ssd"
			} else {
				info.Type = "hdd"
			}
		}
		if strings.HasPrefix(name, "nvme") {
			info.Type = "nvme"
		}
		// SMART health via smartctl if available.
		if _, err := exec.LookPath("smartctl"); err == nil {
			ctx2, cancel := context.WithTimeout(ctx, 10*time.Second)
			out, _ := exec.CommandContext(ctx2, "smartctl", "-H", "-A", "/dev/"+name).CombinedOutput()
			cancel()
			text := string(out)
			for _, ln := range strings.Split(text, "\n") {
				ln = strings.TrimSpace(ln)
				if strings.HasPrefix(ln, "SMART overall-health") || strings.HasPrefix(ln, "SMART Health Status") {
					if strings.Contains(ln, "PASSED") {
						info.Health = "PASSED"
					} else if strings.Contains(ln, "FAILED") {
						info.Health = "FAILED"
					}
				}
				if strings.HasPrefix(ln, "Temperature_Celsius") {
					f := strings.Fields(ln)
					if len(f) >= 10 {
						if v, err := strconv.Atoi(f[9]); err == nil {
							info.TempC = v
						}
					}
				}
				if strings.HasPrefix(ln, "Current_Pending_Sector") || strings.HasPrefix(ln, "Reallocated_Sector_Ct") {
					f := strings.Fields(ln)
					if len(f) >= 10 {
						if v, err := strconv.ParseUint(f[9], 10, 64); err == nil {
							info.ReadErrors += v
						}
					}
				}
			}
		}
		disks = append(disks, info)
	}
	return mounts, disks, nil
}