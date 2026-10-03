package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"

	"lxddash/internal/auth"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// clientIP returns the caller's address for audit logging (X-Forwarded-For
// when behind a proxy, otherwise the direct peer address).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// AuthStatus reports whether the first-run admin setup is still pending.
func (h *Handlers) AuthStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"setup_required": h.deps.Auth.SetupRequired()})
}

// ResetPassword force-sets a new admin password (no old password required).
func (h *Handlers) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "password is required")
		return
	}
	if err := h.deps.Auth.ResetPassword(req.Password); err != nil {
		h.logActivity("auth", "reset-password", "", "password reset FAILED", err)
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.logActivity("auth", "reset-password", "", fmt.Sprintf("admin password reset from %s", clientIP(r)), nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "password reset"})
}

type setupRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Setup creates the admin account on first run and returns a token.
func (h *Handlers) Setup(w http.ResponseWriter, r *http.Request) {
	var req setupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.deps.Auth.Setup(req.Username, req.Password); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.logActivity("auth", "setup", req.Username, "admin account created", nil)
	token, err := h.deps.Auth.Login(req.Username, req.Password)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	token, err := h.deps.Auth.Login(req.Username, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrSetupRequired) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "setup required", "setup_required": true})
			return
		}
		h.logActivity("auth", "login", req.Username,
			fmt.Sprintf("FAILED login from %s", clientIP(r)), errors.New("invalid credentials"))
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	h.logActivity("auth", "login", req.Username, fmt.Sprintf("login from %s", clientIP(r)), nil)
	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// AuthTokens lists all API tokens.
func (h *Handlers) AuthTokens(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.deps.Auth.ListTokens())
}

type createTokenRequest struct {
	Name string `json:"name"`
}

// AuthCreateToken creates a new API token and returns the full token once.
func (h *Handlers) AuthCreateToken(w http.ResponseWriter, r *http.Request) {
	var req createTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	full, meta, err := h.deps.Auth.CreateToken(req.Name)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	h.logActivity("auth", "api-token-create", req.Name, "API token created", nil)
	writeJSON(w, http.StatusOK, map[string]any{"token": full, "meta": meta})
}

// AuthDeleteToken removes an API token by ID.
func (h *Handlers) AuthDeleteToken(w http.ResponseWriter, r *http.Request) {
	if err := h.deps.Auth.DeleteToken(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	h.logActivity("auth", "api-token-delete", r.PathValue("id"), "API token removed", nil)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ChangePassword handles password change requests.
func (h *Handlers) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.NewPassword == "" {
		writeErr(w, http.StatusBadRequest, "new password is required")
		return
	}
	if err := h.deps.Auth.ChangePassword(req.OldPassword, req.NewPassword); err != nil {
		h.logActivity("auth", "password-change", "", "password change FAILED", err)
		writeErr(w, http.StatusUnauthorized, err.Error())
		return
	}
	h.logActivity("auth", "password-change", "", fmt.Sprintf("password changed from %s", clientIP(r)), nil)
	writeJSON(w, http.StatusOK, map[string]string{"status": "password changed"})
}