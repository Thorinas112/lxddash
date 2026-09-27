package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"lxddash/internal/auth"
)

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// AuthStatus reports whether the first-run admin setup is still pending.
func (h *Handlers) AuthStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"setup_required": h.deps.Auth.SetupRequired()})
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
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
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
	writeJSON(w, http.StatusOK, map[string]any{"token": full, "meta": meta})
}

// AuthDeleteToken removes an API token by ID.
func (h *Handlers) AuthDeleteToken(w http.ResponseWriter, r *http.Request) {
	if err := h.deps.Auth.DeleteToken(r.PathValue("id")); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}