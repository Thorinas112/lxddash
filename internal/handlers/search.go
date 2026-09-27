package handlers

import (
	"net/http"
	"strings"
)

// SearchResult is a single match from the global search.
type SearchResult struct {
	Type    string `json:"type"`    // docker | lxd | vm | image
	ID      string `json:"id"`      // container id / instance name / vm uuid / image id
	Name    string `json:"name"`    // display name
	Status  string `json:"status"`  // running/stopped/etc
	Sub     string `json:"sub"`     // secondary info (image, os, etc)
	Link    string `json:"link"`    // frontend route
	Running bool   `json:"running"` // is it running?
}

// Search returns matches across Docker containers, LXD instances, VMs and
// images. Query: ?q=term
func (h *Handlers) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	if q == "" {
		writeJSON(w, http.StatusOK, []SearchResult{})
		return
	}
	results := []SearchResult{}

	// Docker containers
	if h.deps.Docker != nil {
		if cs, err := h.deps.Docker.Containers(r.Context(), true); err == nil {
			for _, c := range cs {
				name := c.Names[0]
				if len(c.Names) > 0 {
					name = strings.TrimPrefix(c.Names[0], "/")
				}
				if match(q, name, c.Image, c.ID) {
					results = append(results, SearchResult{
						Type:    "docker",
						ID:      c.ID,
						Name:    name,
						Status:  string(c.State),
						Sub:     c.Image,
						Link:    "/docker",
						Running: c.State == "running",
					})
				}
			}
		}
	}

	// LXD instances
	if h.deps.LXD != nil {
		if insts, err := h.deps.LXD.Instances(r.Context()); err == nil {
			for i := range insts {
				inst := &insts[i]
				if match(q, inst.Name, inst.Type, inst.Config["image.description"]) {
					results = append(results, SearchResult{
						Type:    "lxd",
						ID:      inst.Name,
						Name:    inst.Name,
						Status:  string(inst.Status),
						Sub:     inst.Config["image.description"],
						Link:    "/lxd",
						Running: inst.Status == "Running",
					})
				}
			}
		}
	}

	// VMs (libvirt)
	if h.deps.Libvirt != nil {
		if domains, err := h.deps.Libvirt.Domains(r.Context()); err == nil {
			for _, d := range domains {
				if match(q, d.Name, d.UUID) {
					results = append(results, SearchResult{
						Type:    "vm",
						ID:      d.UUID,
						Name:    d.Name,
						Status:  d.State,
						Sub:     "KVM/QEMU",
						Link:    "/vms",
						Running: d.State == "running",
					})
				}
			}
		}
	}

	// Docker images
	if h.deps.Docker != nil {
		if imgs, err := h.deps.Docker.Images(r.Context()); err == nil {
			for _, img := range imgs {
				repo := ""
				if len(img.RepoTags) > 0 {
					repo = img.RepoTags[0]
				}
				if match(q, repo, img.ID) {
					results = append(results, SearchResult{
						Type:   "image",
						ID:     img.ID,
						Name:   repo,
						Status: "image",
						Sub:    "Docker image",
						Link:   "/docker",
					})
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, results)
}

func match(q string, fields ...string) bool {
	for _, f := range fields {
		if strings.Contains(strings.ToLower(f), q) {
			return true
		}
	}
	return false
}