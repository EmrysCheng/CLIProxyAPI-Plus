package webui

import (
	"testing"
	"time"
)

func TestSessionLifecycle(t *testing.T) {
	m := newSessionManager()
	defer m.Close()

	token, expiresAt := m.create()
	if token == "" {
		t.Fatal("empty session token")
	}
	if time.Until(expiresAt) < sessionTTL-time.Minute {
		t.Fatalf("session TTL too short: %v", time.Until(expiresAt))
	}
	if !m.validate(token) {
		t.Fatal("fresh token must validate")
	}
	m.delete(token)
	if m.validate(token) {
		t.Fatal("deleted token must not validate")
	}
}

func TestSessionTokensAreUnique(t *testing.T) {
	m := newSessionManager()
	defer m.Close()
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		token, _ := m.create()
		if token == "" || seen[token] {
			t.Fatalf("duplicate or empty token at iteration %d", i)
		}
		seen[token] = true
	}
}

func TestSessionSlidingExpiry(t *testing.T) {
	m := newSessionManager()
	defer m.Close()
	token, first := m.create()
	if !m.validate(token) {
		t.Fatal("validate after create")
	}
	time.Sleep(50 * time.Millisecond)
	// Sliding renewal must push the expiry forward.
	if !m.validate(token) {
		t.Fatal("validate after sleep")
	}
	m.mu.Lock()
	second := m.sessions[token].expiresAt
	m.mu.Unlock()
	if !second.After(first) {
		t.Fatalf("expiry did not slide forward: %v -> %v", first, second)
	}
}

func TestSessionRevokeAll(t *testing.T) {
	m := newSessionManager()
	defer m.Close()
	tokens := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		token, _ := m.create()
		tokens = append(tokens, token)
	}
	m.revokeAll()
	for _, token := range tokens {
		if m.validate(token) {
			t.Fatal("token survived revokeAll")
		}
	}
}

func TestSessionExpiredTokenRejected(t *testing.T) {
	m := newSessionManager()
	defer m.Close()
	token, _ := m.create()
	// Force the entry to look expired.
	m.mu.Lock()
	m.sessions[token] = &sessionEntry{expiresAt: time.Now().Add(-time.Minute)}
	m.mu.Unlock()
	if m.validate(token) {
		t.Fatal("expired token must not validate")
	}
	// And it must have been purged on the failed validation.
	m.mu.Lock()
	_, exists := m.sessions[token]
	m.mu.Unlock()
	if exists {
		t.Fatal("expired session not removed")
	}
}
