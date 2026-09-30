package docker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/netip"
	"os/exec"
	"strings"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/image"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/api/types/volume"
	"github.com/moby/moby/client"
)

// Service wraps the official Docker Engine API client.
type Service struct {
	cli *client.Client
}

func New() (*Service, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	return &Service{cli: cli}, nil
}

// ContainerStat is a live resource snapshot for one container.
type ContainerStat struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	CPUPercent float64 `json:"cpu_percent"`
	CPUUsage   uint64  `json:"cpu_usage"` // cumulative CPU time in ns
	MemUsage   uint64  `json:"mem_usage"`
	MemLimit   uint64  `json:"mem_limit"`
	MemPercent float64 `json:"mem_percent"`
	NetRx      uint64  `json:"net_rx"`
	NetTx      uint64  `json:"net_tx"`
	Pids       uint64  `json:"pids"`
	BlockRead  uint64  `json:"block_read"`
	BlockWrite uint64  `json:"block_write"`
}

// Stats returns live CPU/memory/network usage for all running
// containers. It samples each container once (1s window) so the CPU
// percentage is meaningful.
func (s *Service) Stats(ctx context.Context) ([]ContainerStat, error) {
	cs, err := s.Containers(ctx, false)
	if err != nil {
		return nil, err
	}
	out := make([]ContainerStat, 0, len(cs))
	for _, c := range cs {
		if c.State != "running" {
			continue
		}
		st, err := s.containerStat(ctx, c.ID)
		if err != nil {
			continue
		}
		out = append(out, st)
	}
	return out, nil
}

func (s *Service) containerStat(ctx context.Context, id string) (ContainerStat, error) {
	res, err := s.cli.ContainerStats(ctx, id, client.ContainerStatsOptions{Stream: false})
	if err != nil {
		return ContainerStat{}, err
	}
	defer res.Body.Close()

	var st container.StatsResponse
	if err := json.NewDecoder(res.Body).Decode(&st); err != nil {
		return ContainerStat{}, err
	}

	// CPU percent: delta of total usage over delta of system usage,
	// scaled by the number of online CPUs.
	cpuPercent := 0.0
	if st.PreCPUStats.CPUUsage.TotalUsage > 0 && st.CPUStats.SystemUsage > st.PreCPUStats.SystemUsage {
		cpuDelta := float64(st.CPUStats.CPUUsage.TotalUsage - st.PreCPUStats.CPUUsage.TotalUsage)
		sysDelta := float64(st.CPUStats.SystemUsage - st.PreCPUStats.SystemUsage)
		online := float64(st.CPUStats.OnlineCPUs)
		if online == 0 {
			online = 1
		}
		cpuPercent = (cpuDelta / sysDelta) * online * 100.0
	}

	memUsage := st.MemoryStats.Usage
	memLimit := st.MemoryStats.Limit
	memPercent := 0.0
	if memLimit > 0 {
		memPercent = float64(memUsage) / float64(memLimit) * 100.0
	}

	var netRx, netTx uint64
	for _, n := range st.Networks {
		netRx += n.RxBytes
		netTx += n.TxBytes
	}

	return ContainerStat{
		ID:         st.ID,
		Name:       strings.TrimPrefix(st.Name, "/"),
		CPUPercent: cpuPercent,
		CPUUsage:   st.CPUStats.CPUUsage.TotalUsage,
		MemUsage:   memUsage,
		MemLimit:   memLimit,
		MemPercent: memPercent,
		NetRx:      netRx,
		NetTx:      netTx,
		Pids:       st.PidsStats.Current,
	}, nil
}

// StatsSince returns the CPU/memory delta between two samples, used
// for the per-container history chart. Kept simple: returns the latest
// sample's values.
func (s *Service) StatsSince(ctx context.Context, id string, since time.Time) (ContainerStat, error) {
	return s.containerStat(ctx, id)
}

func (s *Service) Ping(ctx context.Context) error {
	_, err := s.cli.Ping(ctx, client.PingOptions{})
	return err
}

func (s *Service) Containers(ctx context.Context, all bool) ([]container.Summary, error) {
	res, err := s.cli.ContainerList(ctx, client.ContainerListOptions{All: all})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

func (s *Service) Container(ctx context.Context, id string) (*container.InspectResponse, error) {
	res, err := s.cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		return nil, err
	}
	return &res.Container, nil
}

func (s *Service) Start(ctx context.Context, id string) error {
	_, err := s.cli.ContainerStart(ctx, id, client.ContainerStartOptions{})
	return err
}

func (s *Service) Stop(ctx context.Context, id string) error {
	_, err := s.cli.ContainerStop(ctx, id, client.ContainerStopOptions{})
	return err
}

func (s *Service) Restart(ctx context.Context, id string) error {
	_, err := s.cli.ContainerRestart(ctx, id, client.ContainerRestartOptions{})
	return err
}

func (s *Service) Remove(ctx context.Context, id string, force bool) error {
	_, err := s.cli.ContainerRemove(ctx, id, client.ContainerRemoveOptions{Force: force})
	return err
}

func (s *Service) Logs(ctx context.Context, id, tail string) (io.ReadCloser, error) {
	return s.cli.ContainerLogs(ctx, id, client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Tail:       tail,
	})
}

// TagsFromLabels extracts lxddash.tags from container labels.
func TagsFromLabels(labels map[string]string) []string {
	raw := labels["lxddash.tags"]
	if raw == "" {
		return nil
	}
	var tags []string
	for _, t := range strings.Split(raw, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			tags = append(tags, t)
		}
	}
	return tags
}

// Exec starts an interactive shell inside a running container.
// It returns streams for stdin/stdout that can be bridged to a WebSocket.
func (s *Service) Exec(ctx context.Context, id string, stdin io.Reader, stdout io.Writer) error {
	// Create exec instance with TTY — use sh for maximum compatibility.
	execCfg := client.ExecCreateOptions{
		Cmd:          []string{"/bin/sh"},
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		TTY:          true,
	}
	resp, err := s.cli.ExecCreate(ctx, id, execCfg)
	if err != nil {
		return fmt.Errorf("exec create: %w", err)
	}

	// Attach to the exec (bidirectional streams).
	attachResp, err := s.cli.ExecAttach(ctx, resp.ID, client.ExecAttachOptions{TTY: true})
	if err != nil {
		return fmt.Errorf("exec attach: %w", err)
	}
	defer attachResp.Close()

	// Start the exec.
	go func() {
		_, _ = s.cli.ExecStart(ctx, resp.ID, client.ExecStartOptions{TTY: true})
	}()

	// Pump stdin -> exec, exec -> stdout.
	errCh := make(chan error, 2)
	go func() {
		_, err := io.Copy(attachResp.Conn, stdin)
		errCh <- err
	}()
	go func() {
		_, err := io.Copy(stdout, attachResp.Reader)
		errCh <- err
	}()

	// Wait for either direction to finish.
	return <-errCh
}

func (s *Service) Images(ctx context.Context) ([]image.Summary, error) {
	res, err := s.cli.ImageList(ctx, client.ImageListOptions{})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

// PullImage pulls an image and drains the progress stream until done.
func (s *Service) PullImage(ctx context.Context, ref string) error {
	rc, err := s.cli.ImagePull(ctx, ref, client.ImagePullOptions{})
	if err != nil {
		return err
	}
	defer rc.Close()
	dec := json.NewDecoder(rc)
	for {
		var msg map[string]any
		if err := dec.Decode(&msg); err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
	}
}

func (s *Service) RemoveImage(ctx context.Context, id string) error {
	_, err := s.cli.ImageRemove(ctx, id, client.ImageRemoveOptions{Force: true})
	return err
}

func (s *Service) Networks(ctx context.Context) ([]network.Summary, error) {
	res, err := s.cli.NetworkList(ctx, client.NetworkListOptions{})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

func (s *Service) Volumes(ctx context.Context) ([]volume.Volume, error) {
	res, err := s.cli.VolumeList(ctx, client.VolumeListOptions{})
	if err != nil {
		return nil, err
	}
	return res.Items, nil
}

// RemoveVolume deletes a volume by name.
func (s *Service) RemoveVolume(ctx context.Context, name string) error {
	_, err := s.cli.VolumeRemove(ctx, name, client.VolumeRemoveOptions{Force: true})
	return err
}

// RemoveNetwork deletes a network by ID.
func (s *Service) RemoveNetwork(ctx context.Context, id string) error {
	_, err := s.cli.NetworkRemove(ctx, id, client.NetworkRemoveOptions{})
	return err
}

// CreateRequest is the JSON body for creating a container.
type CreateRequest struct {
	Name    string            `json:"name"`
	Image   string            `json:"image"`
	Cmd     []string          `json:"cmd"`
	Env     []string          `json:"env"`
	Ports   []string          `json:"ports"`
	Restart string            `json:"restart"`
	Tags    []string          `json:"tags"`
	Labels  map[string]string `json:"labels"`
}

// CreateContainer creates a container (without starting it).
// Ports are given as "host:container" strings, e.g. "8080:80".
func (s *Service) CreateContainer(ctx context.Context, req CreateRequest) (string, error) {
	exposed := network.PortSet{}
	bindings := network.PortMap{}
	for _, p := range req.Ports {
		parts := strings.SplitN(p, ":", 2)
		if len(parts) != 2 {
			return "", fmt.Errorf("invalid port mapping %q (expected host:container)", p)
		}
		port, err := network.ParsePort(parts[1] + "/tcp")
		if err != nil {
			return "", err
		}
		exposed[port] = struct{}{}
		bindings[port] = []network.PortBinding{{HostIP: netip.MustParseAddr("0.0.0.0"), HostPort: parts[0]}}
	}

	restartPolicy := container.RestartPolicy{Name: container.RestartPolicyDisabled}
	if req.Restart != "" && req.Restart != "no" {
		restartPolicy = container.RestartPolicy{Name: container.RestartPolicyMode(req.Restart)}
	}

	cfg := &container.Config{
		Image:        req.Image,
		Cmd:          req.Cmd,
		Env:          req.Env,
		ExposedPorts: exposed,
	}
	// Merge user labels with lxddash.tags.
	labels := map[string]string{}
	for k, v := range req.Labels {
		labels[k] = v
	}
	if len(req.Tags) > 0 {
		labels["lxddash.tags"] = strings.Join(req.Tags, ",")
	}
	if len(labels) > 0 {
		cfg.Labels = labels
	}
	hostCfg := &container.HostConfig{
		PortBindings:  bindings,
		RestartPolicy: restartPolicy,
	}
	res, err := s.cli.ContainerCreate(ctx, client.ContainerCreateOptions{
		Name:       req.Name,
		Config:     cfg,
		HostConfig: hostCfg,
	})
	if err != nil {
		return "", err
	}
	return res.ID, nil
}

// ComposeUp runs `docker compose up -d` in the given directory.
func (s *Service) ComposeUp(ctx context.Context, dir string) (string, error) {
	return s.runCompose(ctx, dir, "up", "-d")
}

// ComposeDown runs `docker compose down` in the given directory.
func (s *Service) ComposeDown(ctx context.Context, dir string) (string, error) {
	return s.runCompose(ctx, dir, "down")
}

// ComposePull runs `docker compose pull` in the given directory.
func (s *Service) ComposePull(ctx context.Context, dir string) (string, error) {
	return s.runCompose(ctx, dir, "pull")
}

// ComposePS runs `docker compose ps` in the given directory.
func (s *Service) ComposePS(ctx context.Context, dir string) (string, error) {
	return s.runCompose(ctx, dir, "ps")
}

func (s *Service) runCompose(ctx context.Context, dir string, args ...string) (string, error) {
	cmdArgs := append([]string{"compose"}, args...)
	cmd := exec.CommandContext(ctx, "docker", cmdArgs...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("docker compose failed: %v: %s", err, out)
	}
	return string(out), nil
}

// PruneImages removes unused (dangling) images.
func (s *Service) PruneImages(ctx context.Context) (client.ImagePruneResult, error) {
	return s.cli.ImagePrune(ctx, client.ImagePruneOptions{})
}
