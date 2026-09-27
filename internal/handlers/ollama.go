package handlers

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"lxddash/internal/services/ollama"
)

// OllamaModels lists the pulled models.
func (h *Handlers) OllamaModels(w http.ResponseWriter, r *http.Request) {
	if h.deps.Ollama == nil {
		writeErr(w, http.StatusServiceUnavailable, "ollama service unavailable")
		return
	}
	models, err := h.deps.Ollama.ListModels(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, models)
}

type ollamaPullRequest struct {
	Name string `json:"name"`
}

// OllamaPull pulls a model.
func (h *Handlers) OllamaPull(w http.ResponseWriter, r *http.Request) {
	if h.deps.Ollama == nil {
		writeErr(w, http.StatusServiceUnavailable, "ollama service unavailable")
		return
	}
	var req ollamaPullRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if err := h.deps.Ollama.PullModel(r.Context(), req.Name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "pulled"})
}

// OllamaDelete removes a model.
func (h *Handlers) OllamaDelete(w http.ResponseWriter, r *http.Request) {
	if h.deps.Ollama == nil {
		writeErr(w, http.StatusServiceUnavailable, "ollama service unavailable")
		return
	}
	name := r.PathValue("name")
	if err := h.deps.Ollama.DeleteModel(r.Context(), name); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// OllamaChat handles a chat request. If "stream" is true the response
// is a stream of JSON lines; otherwise a single JSON object.
func (h *Handlers) OllamaChat(w http.ResponseWriter, r *http.Request) {
	if h.deps.Ollama == nil {
		writeErr(w, http.StatusServiceUnavailable, "ollama service unavailable")
		return
	}
	var req ollama.ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Model == "" || len(req.Messages) == 0 {
		writeErr(w, http.StatusBadRequest, "model and messages are required")
		return
	}

	if req.Stream {
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.WriteHeader(http.StatusOK)
		if err := h.deps.Ollama.ChatStream(r.Context(), req, w); err != nil {
			// Stream already started; just log via a final line.
			_, _ = w.Write([]byte(`{"error":"` + err.Error() + `"}` + "\n"))
		}
		return
	}

	resp, err := h.deps.Ollama.Chat(r.Context(), req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// OllamaStats returns live resource usage of the Ollama process.
func (h *Handlers) OllamaStats(w http.ResponseWriter, r *http.Request) {
	if h.deps.Ollama == nil {
		writeErr(w, http.StatusServiceUnavailable, "ollama service unavailable")
		return
	}
	models, err := h.deps.Ollama.ListModels(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	stats := ollama.Stats{
		Running: true,
		Models:  models,
	}
	// CPU/memory of the ollama process via the host service.
	if h.deps.Host != nil {
		if p, ok := h.deps.Host.ProcessStats("ollama"); ok {
			stats.CPU = p.CPU
			stats.Memory = p.Memory
		}
	}
	writeJSON(w, http.StatusOK, stats)
}

// OllamaAssist turns a natural-language request into a structured
// resource definition using the local LLM. The context (available
// images, networks, instances) is gathered automatically.
func (h *Handlers) OllamaAssist(w http.ResponseWriter, r *http.Request) {
	if h.deps.Ollama == nil {
		writeErr(w, http.StatusServiceUnavailable, "ollama service unavailable")
		return
	}
	var req ollama.AssistRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Prompt == "" {
		writeErr(w, http.StatusBadRequest, "prompt is required")
		return
	}

	// Gather context: images, networks, instances.
	ctx := r.Context()
	var b strings.Builder
	if h.deps.LXD != nil {
		if imgs, err := h.deps.LXD.Images(ctx); err == nil {
			b.WriteString("Images: ")
			names := []string{}
			for _, img := range imgs {
				if len(img.Aliases) > 0 {
					names = append(names, img.Aliases[0].Name)
				}
			}
			b.WriteString(strings.Join(names, ", "))
			b.WriteString("\n")
		}
		if nets, err := h.deps.LXD.Networks(ctx); err == nil {
			b.WriteString("Networks: ")
			names := []string{}
			for _, n := range nets {
				if n.Managed {
					names = append(names, n.Name)
				}
			}
			b.WriteString(strings.Join(names, ", "))
			b.WriteString("\n")
		}
		if insts, err := h.deps.LXD.Instances(ctx); err == nil {
			b.WriteString("Instances: ")
			names := []string{}
			for _, i := range insts {
				names = append(names, i.Name)
			}
			b.WriteString(strings.Join(names, ", "))
			b.WriteString("\n")
		}
	}
	if h.deps.Libvirt != nil {
		if vms, err := h.deps.Libvirt.Domains(ctx); err == nil {
			b.WriteString("VMs: ")
			names := []string{}
			for _, v := range vms {
				names = append(names, v.Name)
			}
			b.WriteString(strings.Join(names, ", "))
			b.WriteString("\n")
		}
	}
	req.Context = b.String()

	res, err := h.deps.Ollama.Assist(ctx, req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Validate/fix the generated payload against reality: the image
	// must be a local alias, the network a managed network, etc.
	h.fixAssistPayload(res)

	writeJSON(w, http.StatusOK, res)
}

// fixAssistPayload corrects common LLM mistakes in the generated
// payload using the actual state of the system.
func (h *Handlers) fixAssistPayload(res *ollama.AssistResult) {
	payload, ok := res.Payload.(map[string]any)
	if !ok {
		return
	}
	ctx := context.Background()

	// Image must be a local alias.
	if img, ok := payload["image"].(string); ok && img != "" && h.deps.LXD != nil {
		if imgs, err := h.deps.LXD.Images(ctx); err == nil {
			aliases := map[string]bool{}
			for _, i := range imgs {
				for _, a := range i.Aliases {
					aliases[a.Name] = true
				}
			}
			if !aliases[img] {
				// Try the last path segment (e.g. "images/ubuntu-minimal:latest" -> "ubuntu-minimal").
				base := img
				if i := strings.LastIndexAny(base, "/:"); i >= 0 {
					base = base[i+1:]
				}
				if aliases[base] {
					payload["image"] = base
				} else if len(aliases) > 0 {
					// Fall back to the first available alias.
					for a := range aliases {
						payload["image"] = a
						break
					}
				}
			}
		}
	}

	// Network must be a managed network.
	// Also validate that any static IP is within the network's subnet;
	// the LLM often guesses IPs that don't match the real network.
	if netName, ok := payload["network"].(string); ok && netName != "" && h.deps.LXD != nil {
		if nets, err := h.deps.LXD.Networks(ctx); err == nil {
			managed := map[string]bool{}
			networkConfig := map[string]string{}
			for _, n := range nets {
				if n.Managed {
					managed[n.Name] = true
				}
				if n.Name == netName && n.Managed {
					networkConfig = n.Config
				}
			}
			if !managed[netName] {
				// Network not found or not managed — pick the first managed network.
				for n := range managed {
					payload["network"] = n
					netName = n
					break
				}
				for _, n := range nets {
					if n.Name == netName && n.Managed {
						networkConfig = n.Config
						break
					}
				}
			}

			// Validate static IPs against the network's actual subnet.
			// If the LLM guessed wrong IPs, strip them all so DHCP works.
			if ipv4Subnet, ok := networkConfig["ipv4.address"]; ok && ipv4Subnet != "" {
				if _, cidr, err := net.ParseCIDR(ipv4Subnet); err == nil {
					ipInvalid := false
					// Check if the user-provided IP is in the subnet.
					if userIP, ok := payload["ipv4_address"].(string); ok && userIP != "" {
						if parsed := net.ParseIP(userIP); parsed == nil || !cidr.Contains(parsed) {
							ipInvalid = true
						}
					}
					// Check if the gateway is in the subnet.
					if userGW, ok := payload["ipv4_gateway"].(string); ok && userGW != "" {
						if parsed := net.ParseIP(userGW); parsed == nil || !cidr.Contains(parsed) {
							ipInvalid = true
						}
					}
					// Check if DNS is in the subnet.
					if userDNS, ok := payload["dns"].(string); ok && userDNS != "" {
						if parsed := net.ParseIP(userDNS); parsed == nil || !cidr.Contains(parsed) {
							ipInvalid = true
						}
					}
					// If any IP field is wrong, strip them all — let DHCP handle it.
					if ipInvalid {
						delete(payload, "ipv4_address")
						delete(payload, "ipv4_gateway")
						delete(payload, "dns")
					}
				}
			}
		}
	}

	// Backup instance must exist.
	if inst, ok := payload["instance"].(string); ok && inst != "" && h.deps.LXD != nil {
		if insts, err := h.deps.LXD.Instances(ctx); err == nil {
			names := map[string]bool{}
			for _, i := range insts {
				names[i.Name] = true
			}
			if !names[inst] {
				for n := range names {
					payload["instance"] = n
					break
				}
			}
		}
	}
}