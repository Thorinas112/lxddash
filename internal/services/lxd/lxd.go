package lxd

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	incus "github.com/lxc/incus/client"
	"github.com/lxc/incus/shared/api"
)

// Service wraps the official LXD client (unix socket).
type Service struct {
	server incus.InstanceServer

	pullMu    sync.Mutex
	pullTasks map[string]*PullTask
}

// New connects to the LXD unix socket. The HTTP client carries a timeout so
// a half-initialised daemon (e.g. snap LXD still starting or wedged) fails
// fast instead of blocking dashboard startup forever.
func New(socketPath string) (*Service, error) {
	server, err := incus.ConnectIncusUnix(socketPath, &incus.ConnectionArgs{
		HTTPClient: &http.Client{Timeout: 10 * time.Second},
	})
	if err != nil {
		return nil, err
	}
	return &Service{server: server}, nil
}

func (s *Service) Instances(ctx context.Context) ([]api.Instance, error) {
	return s.server.GetInstances(api.InstanceTypeAny)
}

func (s *Service) Instance(ctx context.Context, name string) (*api.Instance, string, error) {
	return s.server.GetInstance(name)
}

// Exec runs an interactive shell inside the instance, bridging the
// given stdin/stdout streams and the control websocket (for window
// resize). Used by the web terminal.
func (s *Service) Exec(ctx context.Context, name string, command []string, width, height int, stdin io.Reader, stdout io.Writer, control func(*websocket.Conn)) error {
	exec := api.InstanceExecPost{
		Command:     command,
		WaitForWS:   true,
		Interactive: true,
		Width:       width,
		Height:      height,
	}
	args := &incus.InstanceExecArgs{
		Stdin:   stdin,
		Stdout:  stdout,
		Stderr:  stdout,
		Control: control,
	}
	op, err := s.server.ExecInstance(name, exec, args)
	if err != nil {
		return err
	}
	return op.Wait()
}

func (s *Service) InstanceState(ctx context.Context, name string) (*api.InstanceState, string, error) {
	return s.server.GetInstanceState(name)
}

// ExecOutput runs a non-interactive command inside the instance and
// returns its combined stdout+stderr output. A non-zero exit code is
// returned as an error, but the captured output is still returned.
func (s *Service) ExecOutput(ctx context.Context, name string, command []string) (string, error) {
	exec := api.InstanceExecPost{
		Command:   command,
		WaitForWS: true,
	}
	var buf bytes.Buffer
	args := &incus.InstanceExecArgs{
		Stdin:    bytes.NewReader(nil),
		Stdout:   &buf,
		Stderr:   &buf,
		DataDone: make(chan bool),
	}
	op, err := s.server.ExecInstance(name, exec, args)
	if err != nil {
		return "", err
	}
	waitErr := op.Wait()
	if args.DataDone != nil {
		<-args.DataDone // wait for all output to be flushed
	}
	return buf.String(), waitErr
}

// UpdateRequest describes changes to an existing instance's network
// and boot settings.
type UpdateRequest struct {
	// Network to attach the primary NIC to (e.g. "lxdbr0").
	Network string `json:"network"`
	// Static IPv4 address for the primary NIC. Empty means DHCP.
	IPv4Address string `json:"ipv4_address"`
	// Static IPv4 gateway. Empty means the network's default.
	IPv4Gateway string `json:"ipv4_gateway"`
	// DNS nameservers (comma-separated).
	DNS string `json:"dns"`
	// Start the instance automatically on host boot.
	AutoStart *bool `json:"auto_start"`
	// Tags (labels) for the instance.
	Tags []string `json:"tags"`
}

// UpdateInstance applies network/boot changes to an existing instance.
func (s *Service) UpdateInstance(ctx context.Context, name string, req UpdateRequest) error {
	inst, etag, err := s.server.GetInstance(name)
	if err != nil {
		return err
	}

	// Update the eth0 NIC device.
	if req.Network != "" {
		nic := map[string]string{
			"type":    "nic",
			"network": req.Network,
		}
		if req.IPv4Address != "" {
			nic["ipv4.address"] = req.IPv4Address
		}
		if req.IPv4Gateway != "" {
			nic["ipv4.gateway"] = req.IPv4Gateway
		}
		if req.DNS != "" {
			nic["dns.nameservers"] = req.DNS
		}
		if inst.Devices == nil {
			inst.Devices = map[string]map[string]string{}
		}
		inst.Devices["eth0"] = nic
	}

	// Update boot.autostart.
	if req.AutoStart != nil {
		if inst.Config == nil {
			inst.Config = map[string]string{}
		}
		if *req.AutoStart {
			inst.Config["boot.autostart"] = "true"
		} else {
			delete(inst.Config, "boot.autostart")
		}
	}

	// Update tags (stored as user.tags, comma-separated).
	if req.Tags != nil {
		if inst.Config == nil {
			inst.Config = map[string]string{}
		}
		if len(req.Tags) > 0 {
			inst.Config["user.tags"] = strings.Join(req.Tags, ",")
		} else {
			delete(inst.Config, "user.tags")
		}
	}

	op, err := s.server.UpdateInstance(name, inst.InstancePut, etag)
	if err != nil {
		return err
	}
	return op.Wait()
}

// CreateRequest is the JSON body for creating an LXD instance.
type CreateRequest struct {
	Name     string                       `json:"name"`
	Image    string                       `json:"image"` // alias or fingerprint
	Type     string                       `json:"type"`  // "container" or "virtual-machine"
	Profiles []string                     `json:"profiles"`
	Config   map[string]string            `json:"config"`
	Devices  map[string]map[string]string `json:"devices"`
	// Network to attach the primary NIC to (e.g. "lxdbr0").
	Network string `json:"network"`
	// Static IPv4 address for the primary NIC (e.g. "10.9.48.100").
	// Empty means DHCP.
	IPv4Address string `json:"ipv4_address"`
	// Static IPv4 gateway (e.g. "10.9.48.1"). Empty means the
	// network's default gateway.
	IPv4Gateway string `json:"ipv4_gateway"`
	// DNS nameservers (comma-separated, e.g. "1.1.1.1,8.8.8.8").
	// Empty means the network's default DNS.
	DNS string `json:"dns"`
	// Start the instance automatically on host boot.
	AutoStart bool `json:"auto_start"`
	// Cloud-init: hostname override (defaults to instance name).
	CloudInitHostname string `json:"cloud_init_hostname"`
	// Cloud-init: username to create (with sudo). Empty = default user.
	CloudInitUser string `json:"cloud_init_user"`
	// Cloud-init: password for the user (plaintext, hashed by cloud-init).
	CloudInitPassword string `json:"cloud_init_password"`
	// Cloud-init: SSH public keys (one per line) to inject.
	CloudInitSSHKeys string `json:"cloud_init_ssh_keys"`
	// Cloud-init: user-data script (runs on first boot).
	CloudInitUserData string `json:"cloud_init_user_data"`
	// Tags (labels) for the instance.
	Tags []string `json:"tags"`
}

func (s *Service) CreateInstance(ctx context.Context, req CreateRequest) error {
	instType := api.InstanceTypeContainer
	if req.Type == "virtual-machine" {
		instType = api.InstanceTypeVM
	}

	// Validate static IPs against the network's actual subnet.
	// The LLM (or user) may guess IPs that don't match the managed
	// network — strip them so DHCP works instead of failing.
	if req.Network != "" && (req.IPv4Address != "" || req.IPv4Gateway != "" || req.DNS != "") {
		nets, netsErr := s.server.GetNetworks()
		if netsErr != nil {
			fmt.Printf("DEBUG: GetNetworks error: %v\n", netsErr)
		}
		for _, n := range nets {
			if n.Name == req.Network && n.Managed {
				subnet := n.Config["ipv4.address"]
				fmt.Printf("DEBUG: network=%s managed=%v config=%v subnet=%s ipv4=%s gw=%s dns=%s\n",
					n.Name, n.Managed, n.Config, subnet, req.IPv4Address, req.IPv4Gateway, req.DNS)
				if subnet != "" {
					_, cidr, err := net.ParseCIDR(subnet)
					if err != nil {
						fmt.Printf("DEBUG: ParseCIDR error: %v\n", err)
					} else {
						ipBad := false
						if req.IPv4Address != "" {
							if ip := net.ParseIP(req.IPv4Address); ip == nil || !cidr.Contains(ip) {
								fmt.Printf("DEBUG: ipv4_address %s NOT in %s\n", req.IPv4Address, subnet)
								ipBad = true
							}
						}
						if req.IPv4Gateway != "" {
							if ip := net.ParseIP(req.IPv4Gateway); ip == nil || !cidr.Contains(ip) {
								fmt.Printf("DEBUG: ipv4_gateway %s NOT in %s\n", req.IPv4Gateway, subnet)
								ipBad = true
							}
						}
						if req.DNS != "" {
							for _, d := range strings.Split(req.DNS, ",") {
								if ip := net.ParseIP(strings.TrimSpace(d)); ip == nil || !cidr.Contains(ip) {
									fmt.Printf("DEBUG: dns %s NOT in %s\n", strings.TrimSpace(d), subnet)
									ipBad = true
									break
								}
							}
						}
						if ipBad {
							fmt.Printf("DEBUG: STRIPPING all static IPs (subnet=%s)\n", subnet)
							req.IPv4Address = ""
							req.IPv4Gateway = ""
							req.DNS = ""
						}
					}
				}
				break
			}
		}
	}

	devices := req.Devices
	if devices == nil {
		devices = map[string]map[string]string{}
	}
	// Attach the primary NIC to the chosen network, with an optional
	// static IPv4 address. If the caller already provided a "eth0"
	// device, leave it alone.
	// NOTE: dns.nameservers is NOT a valid NIC option for managed bridge
	// networks (lxdbr0). DNS is configured via cloud-init instead.
	if req.Network != "" {
		if _, exists := devices["eth0"]; !exists {
			nic := map[string]string{
				"type":    "nic",
				"network": req.Network,
			}
			if req.IPv4Address != "" {
				nic["ipv4.address"] = req.IPv4Address
			}
			if req.IPv4Gateway != "" {
				nic["ipv4.gateway"] = req.IPv4Gateway
			}
			devices["eth0"] = nic
		}
	}

	config := req.Config
	if config == nil {
		config = map[string]string{}
	}
	if req.AutoStart {
		config["boot.autostart"] = "true"
	}
	// Cloud-init configuration.
	// Note: cloud-init.hostname is only supported for VMs; containers
	// use the instance name as hostname automatically.
	if req.CloudInitHostname != "" && instType == api.InstanceTypeVM {
		config["cloud-init.hostname"] = req.CloudInitHostname
	}
	if userData := buildCloudInitUserData(req); userData != "" {
		config["cloud-init.user-data"] = userData
	}
	// Tags (stored as user.tags, comma-separated).
	if len(req.Tags) > 0 {
		config["user.tags"] = strings.Join(req.Tags, ",")
	}

	// Use a custom body so the "source" field can be omitted entirely
	// when creating an empty instance (used by Proxmox container
	// imports, which push the rootfs files afterwards). The incus
	// api.InstancesPost always serializes "source", even when empty,
	// which LXD rejects with "Unknown source type".
	body := struct {
		Name     string                       `json:"name"`
		Type     api.InstanceType             `json:"type"`
		Source   *api.InstanceSource          `json:"source,omitempty"`
		Profiles []string                     `json:"profiles,omitempty"`
		Config   map[string]string            `json:"config,omitempty"`
		Devices  map[string]map[string]string `json:"devices,omitempty"`
	}{
		Name:     req.Name,
		Type:     instType,
		Profiles: req.Profiles,
		Config:   config,
		Devices:  devices,
	}
	if req.Image != "" {
		body.Source = &api.InstanceSource{Type: "image", Alias: req.Image}
	} else {
		// Empty instance (used by Proxmox container imports, which
		// push the rootfs files afterwards). LXD requires an explicit
		// "none" source type for empty instances.
		body.Source = &api.InstanceSource{Type: "none"}
	}

	op, _, err := s.server.RawOperation("POST", "/instances", body, "")
	if err != nil {
		return err
	}
	return op.Wait()
}

// SetState changes the instance state: "start", "stop" or "restart".
func (s *Service) SetState(ctx context.Context, name, action string) error {
	op, err := s.server.UpdateInstanceState(name, api.InstanceStatePut{Action: action, Timeout: -1}, "")
	if err != nil {
		return err
	}
	return op.Wait()
}

func (s *Service) DeleteInstance(ctx context.Context, name string) error {
	op, err := s.server.DeleteInstance(name)
	if err != nil {
		return err
	}
	return op.Wait()
}

func (s *Service) Snapshots(ctx context.Context, name string) ([]api.InstanceSnapshot, error) {
	return s.server.GetInstanceSnapshots(name)
}

func (s *Service) CreateSnapshot(ctx context.Context, name, snapshot string) error {
	op, err := s.server.CreateInstanceSnapshot(name, api.InstanceSnapshotsPost{Name: snapshot})
	if err != nil {
		return err
	}
	return op.Wait()
}

func (s *Service) RestoreSnapshot(ctx context.Context, name, snapshot string) error {
	op, err := s.server.UpdateInstance(name, api.InstancePut{Restore: snapshot}, "")
	if err != nil {
		return err
	}
	return op.Wait()
}

func (s *Service) DeleteSnapshot(ctx context.Context, name, snapshot string) error {
	op, err := s.server.DeleteInstanceSnapshot(name, snapshot)
	if err != nil {
		return err
	}
	return op.Wait()
}

func (s *Service) Images(ctx context.Context) ([]api.Image, error) {
	return s.server.GetImages()
}

// PullImage copies an image from a remote (e.g. "ubuntu:24.04" or a
// simple-streams URL) into the local image store. The alias is passed
// to the server which resolves it with its own client (this avoids
// fingerprint mismatches between client and server versions).
// buildImagePost resolves "ubuntu:24.04"-style remotes into an incus
// image-create request (shared by the sync and tracked pull paths).
func buildImagePost(remote, alias string) (*api.ImagesPost, error) {
	if remote == "" {
		return nil, fmt.Errorf("remote is required (e.g. ubuntu:24.04)")
	}
	// Split "ubuntu:24.04" into server + alias.
	serverURL := remote
	imageAlias := alias
	if i := strings.Index(remote, ":"); i > 0 {
		serverURL = remote[:i]
		imageAlias = remote[i+1:]
	}
	if imageAlias == "" {
		return nil, fmt.Errorf("image alias is required (e.g. ubuntu:24.04)")
	}

	protocol := "simplestreams"
	switch serverURL {
	case "ubuntu":
		// Canonical's own mirror: aliases are plain versions ("24.04").
		serverURL = "https://cloud-images.ubuntu.com/releases"
	case "ubuntu-daily":
		serverURL = "https://cloud-images.ubuntu.com/daily"
	case "images":
		// Canonical's LXD image mirror: aliases carry the distro prefix
		// ("ubuntu/24.04", "alpine/3.24"). This mirror still serves
		// lxd.tar.xz metadata, which older LXD servers can parse
		// (images.linuxcontainers.org only serves incus.tar.xz).
		serverURL = "https://images.lxd.canonical.com"
	case "debian", "alpine", "archlinux", "centos", "fedora", "oracle", "rockylinux", "almalinux", "opensuse", "opensuse-archive", "gentoo", "amazonlinux", "kali", "mint", "nixos", "voidlinux", "freebsd", "openwrt", "busybox", "slackware", "devuan", "alt", "plamo", "netbsd", "openeuler":
		// Distro shortcuts on the canonical mirror:
		// "alpine:3.24" → alias "alpine/3.24".
		serverURL = "https://images.lxd.canonical.com"
		imageAlias = strings.SplitN(remote, ":", 2)[0] + "/" + imageAlias
	default:
		if !strings.HasPrefix(serverURL, "https://") {
			return nil, fmt.Errorf("unknown remote %q (use a well-known name or https:// URL)", serverURL)
		}
		protocol = "incus"
	}

	post := api.ImagesPost{
		ImagePut: api.ImagePut{AutoUpdate: true},
		Source: &api.ImagesPostSource{
			ImageSource: api.ImageSource{
				Alias:     imageAlias,
				Server:    serverURL,
				Protocol:  protocol,
				ImageType: "container",
			},
			Type: "image",
		},
	}
	return &post, nil
}

func (s *Service) PullImage(ctx context.Context, remote, alias string) error {
	post, err := buildImagePost(remote, alias)
	if err != nil {
		return err
	}
	op, err := s.server.CreateImage(*post, nil)
	if err != nil {
		return err
	}
	return op.Wait()
}

// PullTask tracks an in-flight LXD image pull for progress reporting.
type PullTask struct {
	ID              string  `json:"id"`
	Remote          string  `json:"remote"`
	Status          string  `json:"status"`   // running | done | failed
	Progress        float64 `json:"progress"` // 0-100
	Message         string  `json:"message"`
	Error           string  `json:"error,omitempty"`
	DownloadedBytes int64   `json:"downloaded_bytes,omitempty"`
	SpeedBytes      int64   `json:"speed_bytes,omitempty"`
}

// StartPull begins an image pull in the background and returns a task
// handle; poll GetPullTask for progress.
func (s *Service) StartPull(remote, alias string) (*PullTask, error) {
	post, err := buildImagePost(remote, alias)
	if err != nil {
		return nil, err
	}
	op, err := s.server.CreateImage(*post, nil)
	if err != nil {
		return nil, err
	}
	task := &PullTask{
		ID:      fmt.Sprintf("pull-%d", time.Now().UnixNano()),
		Remote:  remote,
		Status:  "running",
		Message: "starting download",
	}
	s.pullMu.Lock()
	if s.pullTasks == nil {
		s.pullTasks = map[string]*PullTask{}
	}
	s.pullTasks[task.ID] = task
	s.pullMu.Unlock()

	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for range ticker.C {
			// This client version's Get() returns the operation snapshot
			// directly; compare the string status for version portability.
			o := op.Get()
			prog, down, speed := pullProgressFromOp(&o)
			switch o.Status {
			case "Success":
				s.updatePull(task.ID, "done", 100, "complete", 0, 0)
				return
			case "Failure", "Cancelled", "Canceling":
				msg := "pull failed"
				if v, ok := o.Metadata["err"]; ok && v != nil {
					msg = fmt.Sprint(v)
				}
				s.updatePull(task.ID, "failed", prog, msg, down, speed)
				return
			default:
				s.updatePull(task.ID, "running", prog, "downloading", down, speed)
			}
		}
	}()
	return task, nil
}

// pullProgressFromOp extracts download percentage/bytes/speed from LXD
// operation metadata (best-effort — keys vary between LXD versions).
func pullProgressFromOp(o *api.Operation) (prog float64, down, speed int64) {
	if o == nil || o.Metadata == nil {
		return 0, 0, 0
	}
	if v, ok := o.Metadata["download_progress"]; ok {
		if f, err := strconv.ParseFloat(fmt.Sprint(v), 64); err == nil {
			prog = f
		}
	}
	if v, ok := o.Metadata["download_bytes"]; ok {
		if f, err := strconv.ParseFloat(fmt.Sprint(v), 64); err == nil {
			down = int64(f)
		}
	}
	if v, ok := o.Metadata["download_speed"]; ok {
		if f, err := strconv.ParseFloat(fmt.Sprint(v), 64); err == nil {
			speed = int64(f)
		}
	}
	return
}

func (s *Service) updatePull(id, status string, prog float64, msg string, down, speed int64) {
	s.pullMu.Lock()
	defer s.pullMu.Unlock()
	if t, ok := s.pullTasks[id]; ok {
		t.Status, t.Progress, t.Message = status, prog, msg
		t.DownloadedBytes, t.SpeedBytes = down, speed
		if status == "failed" {
			t.Error = msg
		}
	}
}

// GetPullTask returns a snapshot of an in-flight pull task.
func (s *Service) GetPullTask(id string) (*PullTask, error) {
	s.pullMu.Lock()
	defer s.pullMu.Unlock()
	t, ok := s.pullTasks[id]
	if !ok {
		return nil, fmt.Errorf("pull task not found")
	}
	cp := *t
	return &cp, nil
}

// DeleteImage removes an image from the local store by fingerprint.
func (s *Service) DeleteImage(ctx context.Context, fingerprint string) error {
	op, err := s.server.DeleteImage(fingerprint)
	if err != nil {
		return err
	}
	return op.Wait()
}

func (s *Service) Profiles(ctx context.Context) ([]api.Profile, error) {
	return s.server.GetProfiles()
}

// CreateProfile creates a new profile.
func (s *Service) CreateProfile(ctx context.Context, name string, config map[string]string, devices map[string]map[string]string) error {
	post := api.ProfilesPost{
		Name:       name,
		ProfilePut: api.ProfilePut{Config: config, Devices: devices},
	}
	return s.server.CreateProfile(post)
}

// UpdateProfile updates an existing profile.
func (s *Service) UpdateProfile(ctx context.Context, name string, config map[string]string, devices map[string]map[string]string) error {
	profile, etag, err := s.server.GetProfile(name)
	if err != nil {
		return err
	}
	profile.Config = config
	profile.Devices = devices
	return s.server.UpdateProfile(name, profile.ProfilePut, etag)
}

// DeleteProfile removes a profile.
func (s *Service) DeleteProfile(ctx context.Context, name string) error {
	return s.server.DeleteProfile(name)
}

func (s *Service) Networks(ctx context.Context) ([]api.Network, error) {
	return s.server.GetNetworks()
}

// CreateNetwork creates a managed bridge network.
func (s *Service) CreateNetwork(ctx context.Context, name, ipv4, ipv6, dns string, nat bool) error {
	config := map[string]string{}
	if ipv4 != "" {
		config["ipv4.address"] = ipv4
		config["ipv4.nat"] = "true"
	}
	if ipv6 != "" {
		config["ipv6.address"] = ipv6
		config["ipv6.nat"] = "true"
	} else {
		config["ipv6.address"] = "none"
	}
	if dns != "" {
		config["dns.nameservers"] = dns
	}
	if !nat {
		config["ipv4.nat"] = "false"
	}
	post := api.NetworksPost{
		NetworkPut: api.NetworkPut{Config: config},
		Name:       name,
		Type:       "bridge",
	}
	return s.server.CreateNetwork(post)
}

// DeleteNetwork removes a managed network.
func (s *Service) DeleteNetwork(ctx context.Context, name string) error {
	return s.server.DeleteNetwork(name)
}

// NetworkACLs lists all network ACLs (firewall rules).
func (s *Service) NetworkACLs(ctx context.Context) ([]api.NetworkACL, error) {
	return s.server.GetNetworkACLs()
}

// CreateNetworkACL creates an ACL with ingress/egress rules.
func (s *Service) CreateNetworkACL(ctx context.Context, name, description string, ingress, egress []api.NetworkACLRule) error {
	post := api.NetworkACLsPost{
		NetworkACLPost: api.NetworkACLPost{Name: name},
		NetworkACLPut: api.NetworkACLPut{
			Description: description,
			Ingress:     ingress,
			Egress:      egress,
		},
	}
	return s.server.CreateNetworkACL(post)
}

// UpdateNetworkACL replaces an ACL's rules.
func (s *Service) UpdateNetworkACL(ctx context.Context, name, description string, ingress, egress []api.NetworkACLRule) error {
	acl, etag, err := s.server.GetNetworkACL(name)
	if err != nil {
		return err
	}
	acl.Description = description
	acl.Ingress = ingress
	acl.Egress = egress
	return s.server.UpdateNetworkACL(name, acl.NetworkACLPut, etag)
}

// DeleteNetworkACL removes an ACL.
func (s *Service) DeleteNetworkACL(ctx context.Context, name string) error {
	return s.server.DeleteNetworkACL(name)
}

// FileEntry is a single entry in a directory listing.
type FileEntry struct {
	Name string `json:"name"`
	Type string `json:"type"` // "file" | "directory"
}

// ListFiles lists the entries of a directory inside an instance.
func (s *Service) ListFiles(ctx context.Context, name, path string) ([]FileEntry, error) {
	// Use SFTP for accurate file/directory detection.
	sftp, err := s.server.GetInstanceFileSFTP(name)
	if err != nil {
		return nil, err
	}
	defer sftp.Close()

	infos, err := sftp.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]FileEntry, 0, len(infos))
	for _, fi := range infos {
		typ := "file"
		if fi.IsDir() {
			typ = "directory"
		}
		out = append(out, FileEntry{Name: fi.Name(), Type: typ})
	}
	return out, nil
}

// ReadFile returns the content of a file inside an instance.
func (s *Service) ReadFile(ctx context.Context, name, path string) ([]byte, error) {
	rc, resp, err := s.server.GetInstanceFile(name, path)
	if err != nil {
		return nil, err
	}
	if rc == nil {
		return nil, nil
	}
	defer rc.Close()
	if resp != nil && resp.Type == "directory" {
		return nil, nil
	}
	return io.ReadAll(rc)
}

// WriteFile writes content to a file inside an instance.
func (s *Service) WriteFile(ctx context.Context, name, path string, content []byte, mode int) error {
	args := incus.InstanceFileArgs{
		Content: bytes.NewReader(content),
		UID:     -1,
		GID:     -1,
		Mode:    mode,
		Type:    "file",
	}
	return s.server.CreateInstanceFile(name, path, args)
}

// PushDirectory recursively copies a local directory into an instance via
// PushDirectory copies a local directory into an instance using the incus
// file push command. The lxc CLI handles paths, permissions, and special
// files correctly even in snap environments when PATH includes /snap/bin.
func (s *Service) PushDirectory(ctx context.Context, instance, localDir, remoteDir string) error {
	env := append(os.Environ(), "PATH=/snap/bin:"+os.Getenv("PATH"))
	cmd := exec.CommandContext(ctx, "lxc", "file", "push", "-r", localDir+"/.", instance+"/"+remoteDir)
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	// lxc file push returns exit code 1 for some special files (device nodes,
	// sockets) but still pushes the majority successfully. Only fail if the
	// output contains no "Pushing" lines (meaning nothing was transferred).
	if err != nil {
		output := string(out)
		if !strings.Contains(output, "Pushing") {
			return fmt.Errorf("lxc file push failed: %v: %s", err, strings.TrimSpace(output))
		}
		// Partial success — log but don't fail the import.
	}
	return nil
}

// DeleteFile removes a file inside an instance.
func (s *Service) DeleteFile(ctx context.Context, name, path string) error {
	return s.server.DeleteInstanceFile(name, path)
}

func (s *Service) StoragePools(ctx context.Context) ([]api.StoragePool, error) {
	return s.server.GetStoragePools()
}

// StorageVolumes lists the custom volumes in a storage pool.
func (s *Service) StorageVolumes(ctx context.Context, pool string) ([]api.StorageVolume, error) {
	return s.server.GetStoragePoolVolumes(pool)
}

// CreateStorageVolume creates a custom volume in a pool.
func (s *Service) CreateStorageVolume(ctx context.Context, pool, name, size, contentType string) error {
	config := map[string]string{}
	if size != "" {
		config["size"] = size
	}
	post := api.StorageVolumesPost{
		StorageVolumePut: api.StorageVolumePut{Config: config},
		Name:             name,
		Type:             "custom",
		ContentType:      contentType,
	}
	return s.server.CreateStoragePoolVolume(pool, post)
}

// DeleteStorageVolume removes a custom volume from a pool.
func (s *Service) DeleteStorageVolume(ctx context.Context, pool, name string) error {
	return s.server.DeleteStoragePoolVolume(pool, "custom", name)
}

// CreateStoragePool creates a new storage pool.
func (s *Service) CreateStoragePool(ctx context.Context, name, driver, size string) error {
	config := map[string]string{}
	if size != "" {
		config["size"] = size
	}
	post := api.StoragePoolsPost{
		StoragePoolPut: api.StoragePoolPut{Config: config},
		Name:           name,
		Driver:         driver,
	}
	return s.server.CreateStoragePool(post)
}

// DeleteStoragePool removes a storage pool.
func (s *Service) DeleteStoragePool(ctx context.Context, name string) error {
	return s.server.DeleteStoragePool(name)
}

// Backups lists the backups of an instance.
func (s *Service) Backups(ctx context.Context, name string) ([]api.InstanceBackup, error) {
	return s.server.GetInstanceBackups(name)
}

// CreateBackup creates a backup of an instance (stored in LXD's
// backup pool, not downloaded).
func (s *Service) CreateBackup(ctx context.Context, name, backup string) error {
	op, err := s.server.CreateInstanceBackup(name, api.InstanceBackupsPost{Name: backup})
	if err != nil {
		return err
	}
	return op.Wait()
}

// DeleteBackup removes a stored backup of an instance.
func (s *Service) DeleteBackup(ctx context.Context, name, backup string) error {
	op, err := s.server.DeleteInstanceBackup(name, backup)
	if err != nil {
		return err
	}
	return op.Wait()
}

// RestoreBackup restores an instance from a stored backup.
func (s *Service) RestoreBackup(ctx context.Context, name, backup string) error {
	op, err := s.server.UpdateInstance(name, api.InstancePut{Restore: backup}, "")
	if err != nil {
		return err
	}
	return op.Wait()
}

// CloneInstance creates a new instance by running lxc copy on the host,
// then fixes the MAC address to avoid conflicts with the source.
func (s *Service) CloneInstance(ctx context.Context, source, newName string) error {
	cmd := exec.Command("lxc", "copy", source, newName)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("lxc copy: %s — %w", strings.TrimSpace(string(out)), err)
	}
	// Fix MAC address conflict — remove the copied eth0 so LXD auto-generates a new one.
	inst, _, err := s.server.GetInstance(newName)
	if err != nil {
		return nil // clone succeeded, MAC fix is best-effort
	}
	if _, ok := inst.Devices["eth0"]; ok {
		delete(inst.Devices, "eth0")
		op, err := s.server.UpdateInstance(newName, api.InstancePut{Devices: inst.Devices}, "")
		if err == nil {
			_ = op.Wait()
		}
	}
	return nil
}

// ResizeInstance updates CPU and memory limits of a running instance.
func (s *Service) ResizeInstance(ctx context.Context, name string, cpu, memory string) error {
	inst, _, err := s.server.GetInstance(name)
	if err != nil {
		return err
	}
	config := inst.Config
	if config == nil {
		config = map[string]string{}
	}
	if cpu != "" {
		config["limits.cpu"] = cpu
	}
	if memory != "" {
		config["limits.memory"] = memory
	}
	op, err := s.server.UpdateInstance(name, api.InstancePut{Config: config}, "")
	if err != nil {
		return err
	}
	return op.Wait()
}

// BulkAction performs start/stop/restart/delete on multiple instances.
func (s *Service) BulkAction(ctx context.Context, names []string, action string) []BulkResult {
	results := make([]BulkResult, 0, len(names))
	for _, name := range names {
		var err error
		switch action {
		case "start":
			err = s.SetState(ctx, name, "start")
		case "stop":
			err = s.SetState(ctx, name, "stop")
		case "restart":
			err = s.SetState(ctx, name, "restart")
		case "delete":
			err = s.DeleteInstance(ctx, name)
		}
		results = append(results, BulkResult{Name: name, Error: err})
	}
	return results
}

// BulkResult is the outcome of a bulk action on a single instance.
type BulkResult struct {
	Name  string `json:"name"`
	Error error  `json:"error,omitempty"`
}

// DownloadBackup exports a backup file to a writer (e.g. HTTP response).
func (s *Service) DownloadBackup(ctx context.Context, name, backup string, w io.Writer) (int64, error) {
	req := incus.BackupFileRequest{
		BackupFile: &writeSeeker{w: w},
	}
	resp, err := s.server.GetInstanceBackupFile(name, backup, &req)
	if err != nil {
		return 0, err
	}
	return resp.Size, nil
}

// writeSeeker wraps an io.Writer to satisfy io.WriteSeeker (needed by incus).
type writeSeeker struct {
	w io.Writer
}

func (ws *writeSeeker) Write(p []byte) (int, error) { return ws.w.Write(p) }
func (ws *writeSeeker) Seek(offset int64, whence int) (int64, error) {
	return 0, nil // not needed for streaming
}

// buildCloudInitUserData assembles the cloud-init user-data from the
// create request. Priority: explicit user-data script > user+password
// > SSH keys only. Returns "" when nothing is configured.
func buildCloudInitUserData(req CreateRequest) string {
	// An explicit user-data script wins (full control).
	if req.CloudInitUserData != "" {
		return req.CloudInitUserData
	}

	keys := strings.TrimSpace(req.CloudInitSSHKeys)
	user := strings.TrimSpace(req.CloudInitUser)
	pass := req.CloudInitPassword
	dns := strings.TrimSpace(req.DNS)

	if user == "" && keys == "" && dns == "" {
		return ""
	}

	var b strings.Builder
	b.WriteString("#cloud-config\n")

	if user != "" {
		// Create a sudo user with password + SSH keys.
		b.WriteString("users:\n")
		b.WriteString("  - name: " + user + "\n")
		b.WriteString("    groups: [sudo, adm]\n")
		b.WriteString("    shell: /bin/bash\n")
		b.WriteString("    sudo: ALL=(ALL) NOPASSWD:ALL\n")
		b.WriteString("    lock_passwd: false\n")
		if pass != "" {
			b.WriteString("    plain_text_passwd: " + pass + "\n")
		}
		if keys != "" {
			b.WriteString("    ssh_authorized_keys:\n")
			b.WriteString(indentYAMLList(keys, 6) + "\n")
		}
		// Ubuntu cloud images disable password auth in sshd by
		// default; re-enable it so the password works over SSH.
		// (Top-level key, not part of the user block.)
		if pass != "" {
			b.WriteString("ssh_pwauth: true\n")
		}
	} else {
		// No custom user: inject keys for the image's default user.
		b.WriteString("ssh_authorized_keys:\n")
		b.WriteString(indentYAMLList(keys, 2) + "\n")
	}

	// DNS nameservers: write /etc/resolv.conf via cloud-init so the
	// container uses the specified DNS servers instead of the network's
	// default. This is needed because dns.nameservers is not a valid
	// NIC device option for managed bridge networks.
	if dns != "" {
		servers := strings.Split(dns, ",")
		b.WriteString("write_files:\n")
		b.WriteString("  - path: /etc/resolv.conf\n")
		b.WriteString("    content: |\n")
		for _, s := range servers {
			s = strings.TrimSpace(s)
			if s != "" {
				b.WriteString("      nameserver " + s + "\n")
			}
		}
		b.WriteString("    permissions: '0644'\n")
	}

	return b.String()
}

// indentYAMLList indents each non-empty line of a multi-line string with the
// given number of spaces so it can be embedded as a YAML list item (e.g. under
// "ssh_authorized_keys:" in a cloud-init user-data block).
func indentYAMLList(s string, indent int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	out := make([]string, 0, len(lines))
	pad := strings.Repeat(" ", indent)
	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" {
			continue
		}
		out = append(out, pad+"- "+ln)
	}
	return strings.Join(out, "\n")
}
