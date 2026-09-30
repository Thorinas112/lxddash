package libvirt

import (
	"context"
	"net"
	"sort"
	"strconv"
	"sync"
	"time"
)

// wellKnownPorts maps common TCP ports to service names shown in the UI.
var wellKnownPorts = map[int]string{
	20: "FTP data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP",
	53: "DNS", 80: "HTTP", 110: "POP3", 123: "NTP", 143: "IMAP",
	443: "HTTPS", 445: "SMB", 554: "RTSP", 587: "SMTP submission",
	631: "IPP/CUPS", 636: "LDAPS", 993: "IMAPS", 995: "POP3S",
	1433: "MSSQL", 1521: "Oracle", 1883: "MQTT", 2049: "NFS",
	2375: "Docker API", 2376: "Docker API (TLS)", 3000: "Node/Express",
	32400: "Plex", 3306: "MySQL", 3389: "RDP", 4357: "HA Observer",
	5000: "Pyramid/iSCSI", 5353: "mDNS/Avahi", 5432: "PostgreSQL",
	5672: "AMQP/RabbitMQ", 5900: "VNC", 6379: "Redis", 8000: "HTTP alt",
	8008: "HTTP alt", 8080: "HTTP proxy", 8081: "HTTP alt",
	8123: "Home Assistant", 8443: "HTTPS alt", 8500: "Consul",
	8883: "MQTT (TLS)", 9000: "Portainer", 9092: "Kafka",
	9100: "Prometheus node", 9200: "Elasticsearch", 9418: "Git",
	10000: "Webmin", 11211: "Memcached", 16654: "Zigbee2MQTT",
	27017: "MongoDB",
}

// CommonScanPorts is the fast pre-check list used by the quick scan.
var CommonScanPorts = []int{
	21, 22, 23, 25, 53, 80, 110, 123, 139, 143, 443, 445, 548, 631,
	993, 995, 1883, 2049, 2375, 2376, 3000, 32400, 3306, 3389, 4357,
	5000, 5353, 5432, 5672, 5900, 6379, 8000, 8008, 8080, 8081, 8123,
	8443, 8500, 8883, 9000, 9092, 9100, 9200, 10000, 11211, 16654, 27017,
}

// PortInfo describes one open TCP port on a VM.
type PortInfo struct {
	Port    int    `json:"port"`
	Service string `json:"service,omitempty"`
}

// ScanPorts TCP-connect-scans ip for the given ports with bounded
// concurrency. Returns the open ports in ascending order.
func ScanPorts(ctx context.Context, ip string, ports []int, concurrency int, timeout time.Duration) []int {
	if concurrency <= 0 {
		concurrency = 256
	}
	if timeout <= 0 {
		timeout = 400 * time.Millisecond
	}
	var (
		mu   sync.Mutex
		open []int
		wg   sync.WaitGroup
		sem  = make(chan struct{}, concurrency)
	)
	for _, p := range ports {
		if ctx.Err() != nil {
			break
		}
		p := p
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			d := net.Dialer{Timeout: timeout}
			conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(ip, strconv.Itoa(p)))
			if err != nil {
				return
			}
			conn.Close()
			mu.Lock()
			open = append(open, p)
			mu.Unlock()
		}()
	}
	wg.Wait()
	sort.Ints(open)
	return open
}

// ScanRange sweeps the full TCP port range 1-65535 in batches (can take
// ~20-40s on a NAT network; refused connections return fast).
func ScanRange(ctx context.Context, ip string) []int {
	var open []int
	const batch = 2048
	for lo := 1; lo <= 65535; lo += batch {
		if ctx.Err() != nil {
			break
		}
		hi := lo + batch - 1
		if hi > 65535 {
			hi = 65535
		}
		batchPorts := make([]int, 0, hi-lo+1)
		for p := lo; p <= hi; p++ {
			batchPorts = append(batchPorts, p)
		}
		open = append(open, ScanPorts(ctx, ip, batchPorts, 300, 400*time.Millisecond)...)
	}
	return open
}

// DescribePort returns a friendly service name for a TCP port ("" if unknown).
func DescribePort(p int) string {
	return wellKnownPorts[p]
}
