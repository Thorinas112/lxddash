package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/lxc/incus/shared/api"
)

// LXDNetworkACLs lists all network ACLs (firewall rules).
func (h *Handlers) LXDNetworkACLs(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	acls, err := h.deps.LXD.NetworkACLs(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, acls)
}

type aclRuleRequest struct {
	Action          string `json:"action"`
	Source          string `json:"source"`
	Destination     string `json:"destination"`
	Protocol        string `json:"protocol"`
	SourcePort      string `json:"source_port"`
	DestinationPort string `json:"destination_port"`
	Description     string `json:"description"`
	State           string `json:"state"`
}

type aclRequest struct {
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Ingress     []aclRuleRequest `json:"ingress"`
	Egress      []aclRuleRequest `json:"egress"`
}

func toACLRules(reqs []aclRuleRequest) []api.NetworkACLRule {
	out := make([]api.NetworkACLRule, 0, len(reqs))
	for _, r := range reqs {
		state := r.State
		if state == "" {
			state = "enabled"
		}
		out = append(out, api.NetworkACLRule{
			Action:          r.Action,
			Source:          r.Source,
			Destination:     r.Destination,
			Protocol:        r.Protocol,
			SourcePort:      r.SourcePort,
			DestinationPort: r.DestinationPort,
			Description:     r.Description,
			State:           state,
		})
	}
	return out
}

// LXDCreateNetworkACL creates a new ACL.
func (h *Handlers) LXDCreateNetworkACL(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req aclRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "ACL name is required")
		return
	}
	if err := h.deps.LXD.CreateNetworkACL(r.Context(), req.Name, req.Description, toACLRules(req.Ingress), toACLRules(req.Egress)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "create-acl", req.Name, "firewall ACL created", nil)
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// LXDUpdateNetworkACL updates an existing ACL.
func (h *Handlers) LXDUpdateNetworkACL(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	var req aclRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.LXD.UpdateNetworkACL(r.Context(), r.PathValue("name"), req.Description, toACLRules(req.Ingress), toACLRules(req.Egress)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "update-acl", r.PathValue("name"), "firewall ACL updated", nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// LXDDeleteNetworkACL removes an ACL.
func (h *Handlers) LXDDeleteNetworkACL(w http.ResponseWriter, r *http.Request) {
	if h.deps.LXD == nil {
		writeErr(w, http.StatusServiceUnavailable, "lxd service unavailable")
		return
	}
	if err := h.deps.LXD.DeleteNetworkACL(r.Context(), r.PathValue("name")); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("lxd", "delete-acl", r.PathValue("name"), "firewall ACL deleted", nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}