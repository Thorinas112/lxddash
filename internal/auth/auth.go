package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"lxddash/internal/config"
)

// ErrSetupRequired is returned by Login when no admin account exists yet.
var ErrSetupRequired = errors.New("setup required")

// adminCredentials is persisted to the data dir (chmod 600).
type adminCredentials struct {
	Username     string `json:"username"`
	PasswordHash string `json:"password_hash"`
}

// APIToken is a long-lived token for automation (curl, scripts, MCP).
type APIToken struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Prefix    string    `json:"prefix"` // first 8 chars, for display
	CreatedAt time.Time `json:"created_at"`
	LastUsed  time.Time `json:"last_used,omitempty"`
}

// apiTokenStore is persisted to the data dir (chmod 600). Only the SHA-256
// hash of each token is stored, so a leaked file can't be used directly.
type apiTokenStore struct {
	Tokens []storedToken `json:"tokens"`
}

type storedToken struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Hash      string    `json:"hash"`
	Prefix    string    `json:"prefix"`
	CreatedAt time.Time `json:"created_at"`
	LastUsed  time.Time `json:"last_used,omitempty"`
}

// Service issues and validates JWT tokens for the dashboard.
type Service struct {
	secret        []byte
	user          string
	hash          []byte
	setupRequired bool
	credsPath     string
	tokensPath    string
	tokens        []storedToken
}

// New builds the auth service. If no admin account exists yet (no password in
// config and no stored credentials), the service is in "setup required" mode
// and the first-run setup page must be completed before login.
func New(cfg *config.Config) (*Service, error) {
	secret, err := loadOrCreateSecret(cfg.DataDir, cfg.JWTSecret)
	if err != nil {
		return nil, err
	}

	s := &Service{secret: secret, credsPath: filepath.Join(cfg.DataDir, "admin.json"), tokensPath: filepath.Join(cfg.DataDir, "api-tokens.json")}
	if err := s.loadTokens(); err != nil {
		return nil, err
	}

	// 1. Explicit password in config wins.
	if cfg.AdminPassword != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		s.user = cfg.AdminUser
		s.hash = hash
		if err := s.persist(); err != nil {
			return nil, err
		}
		return s, nil
	}

	// 2. Stored credentials from a previous run.
	if creds, err := s.load(); err == nil && creds != nil {
		s.user = creds.Username
		s.hash = []byte(creds.PasswordHash)
		return s, nil
	}

	// 3. Legacy: plaintext admin.password from the old auto-generate flow.
	if legacy, err := os.ReadFile(filepath.Join(cfg.DataDir, "admin.password")); err == nil && len(legacy) > 0 {
		hash, err := bcrypt.GenerateFromPassword(legacy, bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		s.user = cfg.AdminUser
		s.hash = hash
		if err := s.persist(); err != nil {
			return nil, err
		}
		_ = os.Remove(filepath.Join(cfg.DataDir, "admin.password"))
		return s, nil
	}

	// 4. No admin account yet — first-run setup required.
	s.setupRequired = true
	return s, nil
}

// loadOrCreateSecret returns the configured JWT secret or generates and
// persists a random one on first run.
func loadOrCreateSecret(dataDir, configured string) ([]byte, error) {
	if configured != "" {
		return []byte(configured), nil
	}
	path := filepath.Join(dataDir, "jwt.secret")
	if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
		return data, nil
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	secret := hex.EncodeToString(buf)
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(secret), 0o600); err != nil {
		return nil, err
	}
	return []byte(secret), nil
}

func (s *Service) persist() error {
	if err := os.MkdirAll(filepath.Dir(s.credsPath), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(adminCredentials{Username: s.user, PasswordHash: string(s.hash)})
	if err != nil {
		return err
	}
	return os.WriteFile(s.credsPath, data, 0o600)
}

func (s *Service) load() (*adminCredentials, error) {
	data, err := os.ReadFile(s.credsPath)
	if err != nil {
		return nil, err
	}
	var creds adminCredentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, err
	}
	if creds.Username == "" || creds.PasswordHash == "" {
		return nil, errors.New("incomplete admin credentials")
	}
	return &creds, nil
}

// SetupRequired reports whether the first-run admin setup is still pending.
func (s *Service) SetupRequired() bool { return s.setupRequired }

// Setup creates the admin account on first run. It only succeeds while the
// service is in setup-required mode.
func (s *Service) Setup(user, password string) error {
	if !s.setupRequired {
		return errors.New("admin account already exists")
	}
	user = strings.TrimSpace(user)
	if user == "" {
		return errors.New("username is required")
	}
	if len(password) < 8 {
		return errors.New("password must be at least 8 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	s.user = user
	s.hash = hash
	if err := s.persist(); err != nil {
		return err
	}
	s.setupRequired = false
	return nil
}

// Login verifies credentials and returns a signed JWT valid for 24h.
func (s *Service) Login(user, password string) (string, error) {
	if s.setupRequired {
		return "", ErrSetupRequired
	}
	if user != s.user {
		return "", errors.New("invalid credentials")
	}
	if bcrypt.CompareHashAndPassword(s.hash, []byte(password)) != nil {
		return "", errors.New("invalid credentials")
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": user,
		"exp": time.Now().Add(24 * time.Hour).Unix(),
	})
	return token.SignedString(s.secret)
}

// Validate checks a bearer token and returns the subject (username).
func (s *Service) Validate(tokenStr string) (string, error) {
	// API tokens are opaque strings starting with "lxd_".
	if strings.HasPrefix(tokenStr, "lxd_") {
		return s.validateAPIToken(tokenStr)
	}
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return s.secret, nil
	})
	if err != nil || !token.Valid {
		return "", errors.New("invalid token")
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid claims")
	}
	sub, _ := claims["sub"].(string)
	return sub, nil
}

// ---- API tokens (for automation) ----

func (s *Service) loadTokens() error {
	data, err := os.ReadFile(s.tokensPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var store apiTokenStore
	if err := json.Unmarshal(data, &store); err != nil {
		return err
	}
	s.tokens = store.Tokens
	return nil
}

func (s *Service) saveTokens() error {
	if err := os.MkdirAll(filepath.Dir(s.tokensPath), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(apiTokenStore{Tokens: s.tokens})
	if err != nil {
		return err
	}
	return os.WriteFile(s.tokensPath, data, 0o600)
}

// CreateToken generates a new API token. The full token is returned only
// once; only its hash is stored.
func (s *Service) CreateToken(name string) (string, APIToken, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", APIToken{}, errors.New("token name is required")
	}
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", APIToken{}, err
	}
	full := "lxd_" + hex.EncodeToString(buf)
	hash := sha256Hex(full)
	id := hex.EncodeToString(buf[:8])
	st := storedToken{
		ID:        id,
		Name:      name,
		Hash:      hash,
		Prefix:    full[:len("lxd_")+8],
		CreatedAt: time.Now(),
	}
	s.tokens = append(s.tokens, st)
	if err := s.saveTokens(); err != nil {
		return "", APIToken{}, err
	}
	return full, APIToken{ID: st.ID, Name: st.Name, Prefix: st.Prefix, CreatedAt: st.CreatedAt}, nil
}

// ListTokens returns all API tokens (without hashes).
func (s *Service) ListTokens() []APIToken {
	out := make([]APIToken, 0, len(s.tokens))
	for _, t := range s.tokens {
		out = append(out, APIToken{ID: t.ID, Name: t.Name, Prefix: t.Prefix, CreatedAt: t.CreatedAt, LastUsed: t.LastUsed})
	}
	return out
}

// DeleteToken removes an API token by ID.
func (s *Service) DeleteToken(id string) error {
	for i, t := range s.tokens {
		if t.ID == id {
			s.tokens = append(s.tokens[:i], s.tokens[i+1:]...)
			return s.saveTokens()
		}
	}
	return errors.New("token not found")
}

func (s *Service) validateAPIToken(full string) (string, error) {
	hash := sha256Hex(full)
	for i := range s.tokens {
		if s.tokens[i].Hash == hash {
			s.tokens[i].LastUsed = time.Now()
			_ = s.saveTokens()
			return "api:" + s.tokens[i].Name, nil
		}
	}
	return "", errors.New("invalid token")
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}