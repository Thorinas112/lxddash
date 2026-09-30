package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/gorilla/websocket"

	"lxddash/internal/services/docker"
)

func (h *Handlers) DockerContainers(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	all := r.URL.Query().Get("all") != "false"
	cs, err := h.deps.Docker.Containers(r.Context(), all)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cs)
}

// DockerStats returns live CPU/memory/network usage for all running
// containers.
func (h *Handlers) DockerStats(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	stats, err := h.deps.Docker.Stats(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (h *Handlers) DockerContainer(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	c, err := h.deps.Docker.Container(r.Context(), r.PathValue("id"))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *Handlers) DockerCreateContainer(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	var req docker.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	id, err := h.deps.Docker.CreateContainer(r.Context(), req)
	if err != nil {
		h.logActivity("docker", "create", req.Name, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("docker", "create", req.Name, "container created", nil)
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *Handlers) DockerStartContainer(w http.ResponseWriter, r *http.Request) {
	h.dockerAction(w, r, "start")
}

func (h *Handlers) DockerStopContainer(w http.ResponseWriter, r *http.Request) {
	h.dockerAction(w, r, "stop")
}

func (h *Handlers) DockerRestartContainer(w http.ResponseWriter, r *http.Request) {
	h.dockerAction(w, r, "restart")
}

func (h *Handlers) dockerAction(w http.ResponseWriter, r *http.Request, action string) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	id := r.PathValue("id")
	var err error
	switch action {
	case "start":
		err = h.deps.Docker.Start(r.Context(), id)
	case "stop":
		err = h.deps.Docker.Stop(r.Context(), id)
	case "restart":
		err = h.deps.Docker.Restart(r.Context(), id)
	}
	if err != nil {
		h.logActivity("docker", action, id, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("docker", action, id, "", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handlers) DockerRemoveContainer(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	id := r.PathValue("id")
	if err := h.deps.Docker.Remove(r.Context(), id, true); err != nil {
		h.logActivity("docker", "remove", id, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("docker", "remove", id, "container removed", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) DockerContainerLogs(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	tail := r.URL.Query().Get("tail")
	if tail == "" {
		tail = "200"
	}
	rc, err := h.deps.Docker.Logs(r.Context(), r.PathValue("id"), tail)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "text/plain")
	_, _ = io.Copy(w, rc)
}

// DockerLogsStream streams container logs via WebSocket.
func (h *Handlers) DockerLogsStream(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	tail := r.URL.Query().Get("tail")
	if tail == "" {
		tail = "100"
	}
	rc, err := h.deps.Docker.Logs(r.Context(), r.PathValue("id"), tail)
	if err != nil {
		conn.WriteMessage(websocket.TextMessage, []byte("Error: "+err.Error()))
		return
	}
	defer rc.Close()
	// Stream log lines as text messages.
	buf := make([]byte, 4096)
	for {
		n, err := rc.Read(buf)
		if n > 0 {
			conn.WriteMessage(websocket.TextMessage, buf[:n])
		}
		if err != nil {
			break
		}
	}
}

func (h *Handlers) DockerImages(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	imgs, err := h.deps.Docker.Images(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, imgs)
}

type pullImageRequest struct {
	Ref string `json:"ref"`
}

func (h *Handlers) DockerPullImage(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	var req pullImageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Docker.PullImage(r.Context(), req.Ref); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "pulled"})
}

func (h *Handlers) DockerRemoveImage(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	if err := h.deps.Docker.RemoveImage(r.Context(), r.PathValue("id")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) DockerNetworks(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	ns, err := h.deps.Docker.Networks(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ns)
}

func (h *Handlers) DockerVolumes(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	vs, err := h.deps.Docker.Volumes(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, vs)
}

func (h *Handlers) DockerRemoveVolume(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	name := r.PathValue("name")
	if err := h.deps.Docker.RemoveVolume(r.Context(), name); err != nil {
		h.logActivity("docker", "remove-volume", name, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("docker", "remove-volume", name, "volume removed", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handlers) DockerRemoveNetwork(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	id := r.PathValue("id")
	if err := h.deps.Docker.RemoveNetwork(r.Context(), id); err != nil {
		h.logActivity("docker", "remove-network", id, "", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("docker", "remove-network", id, "network removed", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

type composeRequest struct {
	Dir string `json:"dir"`
}

func (h *Handlers) DockerComposeUp(w http.ResponseWriter, r *http.Request) {
	h.dockerCompose(w, r, "up")
}

func (h *Handlers) DockerComposeDown(w http.ResponseWriter, r *http.Request) {
	h.dockerCompose(w, r, "down")
}

func (h *Handlers) DockerComposePull(w http.ResponseWriter, r *http.Request) {
	h.dockerCompose(w, r, "pull")
}

func (h *Handlers) DockerComposePS(w http.ResponseWriter, r *http.Request) {
	h.dockerCompose(w, r, "ps")
}

func (h *Handlers) dockerCompose(w http.ResponseWriter, r *http.Request, action string) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	var req composeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Dir == "" {
		writeErr(w, http.StatusBadRequest, "dir is required")
		return
	}
	var out string
	var err error
	switch action {
	case "up":
		out, err = h.deps.Docker.ComposeUp(r.Context(), req.Dir)
	case "down":
		out, err = h.deps.Docker.ComposeDown(r.Context(), req.Dir)
	case "pull":
		out, err = h.deps.Docker.ComposePull(r.Context(), req.Dir)
	case "ps":
		out, err = h.deps.Docker.ComposePS(r.Context(), req.Dir)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"output": out})
}

// DockerPruneImages removes unused Docker images.
func (h *Handlers) DockerPruneImages(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	report, err := h.deps.Docker.PruneImages(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"images_deleted":  len(report.Report.ImagesDeleted),
		"space_reclaimed": report.Report.SpaceReclaimed,
	})
}

// DockerExec opens a WebSocket that bridges to an interactive shell inside a Docker container.
func (h *Handlers) DockerExec(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	id := r.PathValue("id")

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Start exec in goroutine.
	execErr := make(chan error, 1)
	go func() {
		execErr <- h.deps.Docker.Exec(ctx, id, stdinR, stdoutW)
	}()

	// Stream exec stdout -> browser WebSocket.
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdoutR.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					cancel()
					return
				}
			}
			if err != nil {
				cancel()
				return
			}
		}
	}()

	// Stream browser WebSocket -> exec stdin, handle resize messages.
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			cancel()
			break
		}
		if mt == websocket.TextMessage {
			var msg struct {
				Type string `json:"type"`
				Cols int    `json:"cols"`
				Rows int    `json:"rows"`
			}
			if err := json.Unmarshal(data, &msg); err == nil && msg.Type == "resize" {
				// Docker exec doesn't support resize through the API the same way,
				// but we accept the message silently.
				continue
			}
			if _, werr := stdinW.Write(data); werr != nil {
				cancel()
				break
			}
			continue
		}
		if mt == websocket.BinaryMessage {
			if _, werr := stdinW.Write(data); werr != nil {
				cancel()
				break
			}
		}
	}

	<-execErr
}

// DockerComposeDeploy writes a compose YAML to a temp file and runs docker compose up.
func (h *Handlers) DockerComposeDeploy(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	var req struct {
		YAML   string `json:"yaml"`
		Name   string `json:"name"`
		Dir    string `json:"dir"`
		Action string `json:"action"` // "up" (default), "down", "pull"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.YAML == "" {
		writeErr(w, http.StatusBadRequest, "yaml required")
		return
	}
	if req.Action == "" {
		req.Action = "up"
	}
	if req.Dir == "" {
		req.Dir = "/tmp"
	}
	if req.Name == "" {
		req.Name = "lxddash-deploy"
	}
	// Write compose file.
	composePath := req.Dir + "/docker-compose-" + req.Name + ".yaml"
	if err := os.WriteFile(composePath, []byte(req.YAML), 0644); err != nil {
		writeErr(w, http.StatusInternalServerError, "write compose file: "+err.Error())
		return
	}
	defer os.Remove(composePath)
	// Run compose action.
	output, err := h.deps.Docker.ComposeUp(r.Context(), req.Dir)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("docker", "compose-up", req.Name, "compose up completed", nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "up", "name": req.Name, "output": output})
}

// DockerBulkAction performs start/stop/restart/remove on multiple containers.
func (h *Handlers) DockerBulkAction(w http.ResponseWriter, r *http.Request) {
	if h.deps.Docker == nil {
		writeErr(w, http.StatusServiceUnavailable, "docker service unavailable")
		return
	}
	var req struct {
		Names  []string `json:"names"`
		Action string   `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Names) == 0 {
		writeErr(w, http.StatusBadRequest, "names and action required")
		return
	}
	type result struct {
		Name  string `json:"name"`
		Error string `json:"error,omitempty"`
	}
	var results []result
	for _, id := range req.Names {
		var err error
		switch req.Action {
		case "start":
			err = h.deps.Docker.Start(r.Context(), id)
		case "stop":
			err = h.deps.Docker.Stop(r.Context(), id)
		case "restart":
			err = h.deps.Docker.Restart(r.Context(), id)
		case "remove":
			err = h.deps.Docker.Remove(r.Context(), id, true)
		}
		r := result{Name: id}
		if err != nil {
			r.Error = err.Error()
		}
		results = append(results, r)
	}
	h.logActivity("docker", "bulk-"+req.Action, "", fmt.Sprintf("%s on %d containers", req.Action, len(req.Names)), nil)
	writeJSON(w, http.StatusOK, results)
}
