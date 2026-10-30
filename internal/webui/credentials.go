// Package webui provides the built-in web management panel for CLIProxyAPI.
// It serves an embedded single-page application under /panel and exposes a
// password-authenticated session layer that proxies the existing management
// API handlers, so the panel can operate every server feature from a browser.
package webui

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// PanelAuthFileName is the credential store file kept next to config.yaml.
// It is intentionally separate from config.yaml so that config rewrites
// (e.g. PUT /v0/management/config.yaml) can never lock the operator out.
const PanelAuthFileName = "panel-auth.json"

// panelCredentials is the on-disk representation of the panel administrator.
// Only the bcrypt hash is persisted; the plaintext password is never stored.
type panelCredentials struct {
	PasswordHash string    `json:"password_hash"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// ErrSetupRequired is returned when credentials have not been created yet.
var ErrSetupRequired = errors.New("panel setup required")

type credentialStore struct {
	mu   sync.RWMutex
	path string
	cred *panelCredentials
}

func newCredentialStore(configFilePath string) *credentialStore {
	dir := filepath.Dir(configFilePath)
	if dir == "" {
		dir = "."
	}
	return &credentialStore{path: filepath.Join(dir, PanelAuthFileName)}
}

// load reads the credential file from disk if present and caches it.
func (s *credentialStore) load() {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := os.ReadFile(s.path)
	if err != nil {
		s.cred = nil
		return
	}
	var cred panelCredentials
	if err := json.Unmarshal(raw, &cred); err != nil || cred.PasswordHash == "" {
		s.cred = nil
		return
	}
	s.cred = &cred
}

// SetupRequired reports whether the panel administrator password has been created.
func (s *credentialStore) SetupRequired() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cred == nil
}

// Setup stores the initial administrator password. It fails when credentials
// already exist so the onboarding endpoint can never overwrite an operator.
func (s *credentialStore) Setup(password string) error {
	if s.cred != nil {
		return errors.New("panel already configured")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	now := time.Now().UTC()
	return s.write(&panelCredentials{PasswordHash: string(hash), CreatedAt: now, UpdatedAt: now})
}

// Update replaces the password after verifying the old one. revokeExcept, when
// non-nil, is invoked after a successful write so stale sessions can be dropped.
func (s *credentialStore) Update(oldPassword, newPassword string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cred == nil {
		return ErrSetupRequired
	}
	if err := bcrypt.CompareHashAndPassword([]byte(s.cred.PasswordHash), []byte(oldPassword)); err != nil {
		return errors.New("current password is incorrect")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	updated := *s.cred
	updated.PasswordHash = string(hash)
	updated.UpdatedAt = time.Now().UTC()
	return s.writeLocked(&updated)
}

// Verify reports whether the provided password matches the stored hash.
func (s *credentialStore) Verify(password string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.cred == nil {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(s.cred.PasswordHash), []byte(password)) == nil
}

func (s *credentialStore) write(cred *panelCredentials) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.writeLocked(cred)
}

func (s *credentialStore) writeLocked(cred *panelCredentials) error {
	raw, err := json.MarshalIndent(cred, "", "  ")
	if err != nil {
		return fmt.Errorf("encode panel credentials: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	if err := os.WriteFile(s.path, raw, 0o600); err != nil {
		return fmt.Errorf("write panel credentials: %w", err)
	}
	s.cred = cred
	return nil
}
