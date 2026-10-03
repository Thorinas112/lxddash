package handlers

import (
	"encoding/json"
	"net/http"
)

// NetworkLanInfo returns LAN detection data plus the per-runtime status of
// the macvlan "lan" networks (router DHCP).
func (h *Handlers) NetworkLanInfo(w http.ResponseWriter, r *http.Request) {
	if h.deps.Host == nil {
		writeErr(w, http.StatusServiceUnavailable, "host service unavailable")
		return
	}
	lan, err := h.deps.Host.LanInfo()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := map[string]any{
		"parent": lan.Parent, "cidr": lan.CIDR, "addr": lan.Addr,
		"gateway": lan.Gateway, "ifaces": lan.Ifaces,
		"lxd":     map[string]any{"exists": false},
		"libvirt": map[string]any{"exists": false},
		"docker":  map[string]any{"exists": false},
	}
	if h.deps.LXD != nil {
		if nets, err := h.deps.LXD.Networks(r.Context()); err == nil {
			for _, n := range nets {
				if n.Name == "lan" {
					resp["lxd"] = map[string]any{"exists": true, "name": n.Name}
				}
			}
		}
	}
	if h.deps.Libvirt != nil {
		if nets, err := h.deps.Libvirt.Networks(r.Context()); err == nil {
			for _, n := range nets {
				if n.Name == "lan" {
					resp["libvirt"] = map[string]any{"exists": true, "name": n.Name, "active": n.Active}
				}
			}
		}
	}
	if h.deps.Docker != nil {
		if nets, err := h.deps.Docker.Networks(r.Context()); err == nil {
			for _, n := range nets {
				if n.Name == "lan" {
					resp["docker"] = map[string]any{"exists": true, "name": n.Name}
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

type lanSetupRequest struct {
	Parent        string   `json:"parent"`
	LXDName       string   `json:"lxd_name"`
	LibvirtName   string   `json:"libvirt_name"`
	DockerName    string   `json:"docker_name"`
	DockerSubnet  string   `json:"docker_subnet"`
	DockerGateway string   `json:"docker_gateway"`
	Runtimes      []string `json:"runtimes"`
}

// NetworkLanSetup creates macvlan networks for the selected runtimes so new
// containers/VMs get IPs from the router's DHCP.
func (h *Handlers) NetworkLanSetup(w http.ResponseWriter, r *http.Request) {
	var req lanSetupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Parent == "" && h.deps.Host != nil {
		if lan, err := h.deps.Host.LanInfo(); err == nil {
			req.Parent = lan.Parent
		}
	}
	if req.Parent == "" {
		writeErr(w, http.StatusBadRequest, "parent interface is required")
		return
	}
	if req.LXDName == "" {
		req.LXDName = "lan"
	}
	if req.LibvirtName == "" {
		req.LibvirtName = "lan"
	}
	if req.DockerName == "" {
		req.DockerName = "lan"
	}

	want := map[string]bool{}
	for _, rt := range req.Runtimes {
		want[rt] = true
	}
	if len(want) == 0 {
		want["lxd"], want["libvirt"], want["docker"] = true, true, true
	}

	results := map[string]string{}
	if want["lxd"] {
		switch {
		case h.deps.LXD == nil:
			results["lxd"] = "skipped (lxd unavailable)"
		default:
			nets, nerr := h.deps.LXD.Networks(r.Context())
			exists := nerr == nil
			for _, n := range nets {
				if n.Name == req.LXDName {
					exists = true
					break
				}
			}
			if exists {
				results["lxd"] = "already exists — kept"
			} else if err := h.deps.LXD.CreateMacvlanNetwork(r.Context(), req.LXDName, req.Parent); err != nil {
				results["lxd"] = "error: " + err.Error()
			} else {
				results["lxd"] = "created " + req.LXDName
				h.logActivity("lxd", "create-network", req.LXDName, "macvlan LAN network created", nil)
			}
		}
	}
	if want["libvirt"] {
		switch {
		case h.deps.Libvirt == nil:
			results["libvirt"] = "skipped (libvirt unavailable)"
		default:
			nets, nerr := h.deps.Libvirt.Networks(r.Context())
			exists := nerr == nil
			for _, n := range nets {
				if n.Name == req.LibvirtName {
					exists = true
					break
				}
			}
			if exists {
				results["libvirt"] = "already exists — kept"
			} else if err := h.deps.Libvirt.CreateLANNetwork(r.Context(), req.LibvirtName, req.Parent); err != nil {
				results["libvirt"] = "error: " + err.Error()
			} else {
				results["libvirt"] = "created " + req.LibvirtName
				h.logActivity("vm", "create-network", req.LibvirtName, "LAN network created", nil)
			}
		}
	}
	if want["docker"] {
		switch {
		case h.deps.Docker == nil:
			results["docker"] = "skipped (docker unavailable)"
		case req.DockerSubnet == "" || req.DockerGateway == "":
			results["docker"] = "error: subnet and gateway are required for docker macvlan"
		default:
			nets, nerr := h.deps.Docker.Networks(r.Context())
			exists := nerr == nil
			for _, n := range nets {
				if n.Name == req.DockerName {
					exists = true
					break
				}
			}
			if exists {
				results["docker"] = "already exists — kept"
			} else if err := h.deps.Docker.CreateLANNetwork(r.Context(), req.DockerName, req.Parent, req.DockerSubnet, req.DockerGateway); err != nil {
				results["docker"] = "error: " + err.Error()
			} else {
				results["docker"] = "created " + req.DockerName
				h.logActivity("docker", "create-network", req.DockerName, "macvlan LAN network created", nil)
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"parent": req.Parent, "results": results})
}
