package handlers

import (
	"context"
	"net/http"
	"time"
)

type overview struct {
	Host        any `json:"host"`
	DockerCount int `json:"docker_count"`
	DockerOK    bool `json:"docker_ok"` // service reachable, even with 0 containers
	LXDCount    int `json:"lxd_count"`
	LXDOK       bool `json:"lxd_ok"` // service reachable, even with 0 instances
	VMCount     int `json:"vm_count"`
	LibvirtOK   bool `json:"libvirt_ok"` // service reachable, even with 0 VMs
}

// OverviewData collects host stats and resource counts. Used by both the
// REST endpoint and the WebSocket broadcaster.
func (h *Handlers) OverviewData(ctx context.Context) (*overview, error) {
	ov := &overview{}
	if h.deps.Host != nil {
		if stats, err := h.deps.Host.Stats(ctx); err == nil {
			ov.Host = stats
		}
	}
	if h.deps.Docker != nil {
		if cs, err := h.deps.Docker.Containers(ctx, true); err == nil {
			ov.DockerCount = len(cs)
			ov.DockerOK = true
		}
	}
	if h.deps.LXD != nil {
		if insts, err := h.deps.LXD.Instances(ctx); err == nil {
			ov.LXDCount = len(insts)
			ov.LXDOK = true
		}
	}
	if h.deps.Libvirt != nil {
		if doms, err := h.deps.Libvirt.Domains(ctx); err == nil {
			ov.VMCount = len(doms)
			ov.LibvirtOK = true
		}
	}
	return ov, nil
}

func (h *Handlers) Overview(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ov, err := h.OverviewData(ctx)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ov)
}