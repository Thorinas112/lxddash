package ollama

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Service talks to a local Ollama instance (default http://localhost:11434).
type Service struct {
	baseURL string
	client  *http.Client
}

func New(baseURL string) *Service {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	return &Service{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 5 * time.Minute},
	}
}

// Model describes a pulled model.
type Model struct {
	Name       string `json:"name"`
	Model      string `json:"model"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modified_at"`
	Digest     string `json:"digest"`
}

// ListModels returns the pulled models.
func (s *Service) ListModels(ctx context.Context) ([]Model, error) {
	var resp struct {
		Models []Model `json:"models"`
	}
	if err := s.get(ctx, "/api/tags", &resp); err != nil {
		return nil, err
	}
	return resp.Models, nil
}

// PullModel pulls a model by name (e.g. "llama3.2:1b").
func (s *Service) PullModel(ctx context.Context, name string) error {
	body, _ := json.Marshal(map[string]string{"name": name, "stream": "false"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+"/api/pull", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("pull failed: %s: %s", resp.Status, string(b))
	}
	// Drain the stream.
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// DeleteModel removes a model.
func (s *Service) DeleteModel(ctx context.Context, name string) error {
	body, _ := json.Marshal(map[string]string{"name": name})
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.baseURL+"/api/delete", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("delete failed: %s: %s", resp.Status, string(b))
	}
	return nil
}

// ChatRequest is a single chat completion request.
type ChatRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

// ChatMessage is one message in a conversation.
type ChatMessage struct {
	Role    string `json:"role"` // "system", "user", "assistant"
	Content string `json:"content"`
}

// ChatResponse is a non-streaming chat response.
type ChatResponse struct {
	Model     string `json:"model"`
	Message   ChatMessage `json:"message"`
	Done      bool   `json:"done"`
	EvalCount int    `json:"eval_count"`
	EvalDuration int64 `json:"eval_duration"`
	TotalDuration int64 `json:"total_duration"`
	LoadDuration  int64 `json:"load_duration"`
}

// Chat sends a chat request and returns the full response.
func (s *Service) Chat(ctx context.Context, req ChatRequest) (*ChatResponse, error) {
	req.Stream = false
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("chat failed: %s: %s", resp.Status, string(b))
	}
	var out ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ChatStream streams chat completion chunks to the given writer as
// JSON lines ({"message":{"content":"..."}}).
func (s *Service) ChatStream(ctx context.Context, req ChatRequest, w io.Writer) error {
	req.Stream = true
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+"/api/chat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(httpReq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("chat failed: %s: %s", resp.Status, string(b))
	}
	_, err = io.Copy(w, resp.Body)
	return err
}

// AssistRequest asks the LLM to generate a resource definition from a
// natural-language request.
type AssistRequest struct {
	Model   string `json:"model"`
	Prompt  string `json:"prompt"`
	Context string `json:"context"` // available images/networks/instances
}

// AssistResult is the structured output of the assistant.
type AssistResult struct {
	Action      string `json:"action"` // create-lxd | create-vm | create-docker | create-network | create-profile | create-acl | create-backup | unknown
	Explanation string `json:"explanation"`
	Payload     any    `json:"payload"`
}

// systemPrompt instructs the LLM to always answer with strict JSON.
// Kept short so small models don't truncate.
const assistSystemPrompt = `You are an infrastructure assistant. The user describes what to create.
Reply with ONLY one JSON object, no markdown, no commentary:
{"action": "...", "explanation": "short summary", "payload": {...}}

action: create-lxd | create-vm | create-docker | create-network | create-profile | create-acl | create-backup | unknown

create-lxd payload: {"name":str,"type":"container","image":str,"network":str,"ipv4_address":str,"ipv4_gateway":str,"dns":str,"auto_start":bool,"cloud_init_user":str,"cloud_init_password":str,"cloud_init_ssh_keys":str,"config":{"limits.memory":"1024MiB","limits.cpu":"1"},"tags":[str]}

IMPORTANT for create-lxd:
- DO NOT set ipv4_address, ipv4_gateway, or dns unless the user provides a specific valid IP in the correct subnet.
- If the user says "DHCP" or "get ip from router" or does not specify an IP, leave ipv4_address, ipv4_gateway, and dns OUT of the payload entirely. The container will automatically get an IP from the network's DHCP server.
- Only set static IPs when the user gives an exact IP address AND you know the network's subnet.

create-vm payload: {"name":str,"memory_mb":int,"vcpus":int,"disk_gb":int,"iso":str}
create-docker payload: {"name":str,"image":str,"ports":[str],"env":[str],"restart":"unless-stopped"}
create-network payload: {"name":str,"ipv4":str,"ipv6":str,"dns":str,"nat":bool}
create-profile payload: {"name":str,"config":{str:str},"devices":{str:{str:str}}}
create-acl payload: {"name":str,"description":str,"ingress":[{"action":"allow","protocol":"tcp","source":str,"destination":str,"destination_port":str,"description":str}],"egress":[]}
create-backup payload: {"name":str,"instance":str,"schedule":"daily","retention":int}

Use images/networks/instances from the available resources when given. Pick sensible defaults otherwise.`

// Assist asks the LLM to turn a natural-language request into a
// structured resource definition. Small models often produce
// truncated or repeated JSON, so we extract the first valid JSON
// object and retry once if needed.
func (s *Service) Assist(ctx context.Context, req AssistRequest) (*AssistResult, error) {
	model := req.Model
	if model == "" {
		model = "llama3.2:1b"
	}
	userMsg := "User request: " + req.Prompt
	if req.Context != "" {
		userMsg += "\n\nAvailable resources:\n" + req.Context
	}

	chat := func(messages []ChatMessage) (string, error) {
		resp, err := s.Chat(ctx, ChatRequest{Model: model, Messages: messages})
		if err != nil {
			return "", err
		}
		return resp.Message.Content, nil
	}

	content, err := chat([]ChatMessage{
		{Role: "system", Content: assistSystemPrompt},
		{Role: "user", Content: userMsg},
	})
	if err != nil {
		return nil, err
	}

	var out AssistResult
	if err := json.Unmarshal([]byte(extractJSON(content)), &out); err != nil {
		// Retry once with a stricter instruction.
		fixed, err2 := chat([]ChatMessage{
			{Role: "system", Content: assistSystemPrompt + "\nIMPORTANT: output exactly one JSON object and nothing else."},
			{Role: "user", Content: userMsg},
		})
		if err2 != nil {
			return nil, fmt.Errorf("LLM returned invalid JSON: %v\n%s", err, content)
		}
		if err3 := json.Unmarshal([]byte(extractJSON(fixed)), &out); err3 != nil {
			return nil, fmt.Errorf("LLM returned invalid JSON: %v\n%s", err, fixed)
		}
	}
	if out.Action == "" {
		out.Action = "unknown"
	}
	// Normalize common model variations of action names.
	switch out.Action {
	case "create-container", "create-instance", "create-lxd-container", "create-lxc":
		out.Action = "create-lxd"
	case "create-docker-container", "create-container-docker":
		out.Action = "create-docker"
	case "create-virtual-machine", "create-kvm", "create-qemu":
		out.Action = "create-vm"
	case "create-acl", "create-firewall", "create-firewall-acl":
		out.Action = "create-acl"
	case "create-storage-pool", "create-pool":
		out.Action = "create-storage-pool"
	case "create-storage-volume", "create-volume":
		out.Action = "create-storage-volume"
	case "create-backup-job", "create-job":
		out.Action = "create-backup"
	}
	normalizePayload(out.Payload)
	return &out, nil
}

// normalizePayload fixes common LLM quirks in the generated payload
// (in place): numeric memory -> "512MiB", ipv4_address moved out of
// config, etc.
func normalizePayload(p any) {
	m, ok := p.(map[string]any)
	if !ok {
		return
	}
	// limits.memory as a number -> "NMiB" string.
	if cfg, ok := m["config"].(map[string]any); ok {
		if mem, ok := cfg["limits.memory"]; ok {
			switch v := mem.(type) {
			case float64:
				cfg["limits.memory"] = fmt.Sprintf("%dMiB", int(v))
			case int:
				cfg["limits.memory"] = fmt.Sprintf("%dMiB", v)
			case string:
				if v != "" && !strings.ContainsAny(v, "MiBGiBKB") {
					cfg["limits.memory"] = v + "MiB"
				}
			}
		}
		// ipv4_address / ipv4_gateway / dns sometimes end up in config.
		for _, k := range []string{"ipv4_address", "ipv4_gateway", "dns"} {
			if v, ok := cfg[k]; ok {
				if _, exists := m[k]; !exists {
					m[k] = v
				}
				delete(cfg, k)
			}
		}
	}
	// memory_mb as a string -> int.
	if v, ok := m["memory_mb"]; ok {
		switch t := v.(type) {
		case string:
			if n, err := strconv.Atoi(t); err == nil {
				m["memory_mb"] = n
			}
		case float64:
			m["memory_mb"] = int(t)
		}
	}
	// ports as a string -> []string.
	if v, ok := m["ports"]; ok {
		if s, ok := v.(string); ok {
			s = strings.TrimSpace(s)
			s = strings.TrimPrefix(s, "[")
			s = strings.TrimSuffix(s, "]")
			parts := []string{}
			for _, p := range strings.Split(s, ",") {
				p = strings.TrimSpace(p)
				if p != "" {
					parts = append(parts, p)
				}
			}
			m["ports"] = parts
		}
	}
}

// extractJSON finds the first valid JSON object in a model response.
// Small models sometimes emit multiple objects or trailing text.
func extractJSON(s string) string {
	start := strings.IndexByte(s, '{')
	if start < 0 {
		return s
	}
	// Try progressively longer substrings from the first '{' until
	// one parses as a complete JSON object.
	depth := 0
	inStr := false
	esc := false
	for i := start; i < len(s); i++ {
		c := s[i]
		if inStr {
			if esc {
				esc = false
				continue
			}
			if c == '\\' {
				esc = true
				continue
			}
			if c == '"' {
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				candidate := s[start : i+1]
				if json.Valid([]byte(candidate)) {
					return candidate
				}
			}
		}
	}
	return s
}

// Stats returns live resource usage of the Ollama process (CPU, RAM).
type Stats struct {
	Running bool    `json:"running"`
	Version string  `json:"version"`
	CPU     float64 `json:"cpu_percent"`
	Memory  uint64  `json:"memory_bytes"`
	Models  []Model `json:"models"`
}

func (s *Service) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("GET %s failed: %s: %s", path, resp.Status, string(b))
	}
	return json.NewDecoder(resp.Body).Decode(out)
}