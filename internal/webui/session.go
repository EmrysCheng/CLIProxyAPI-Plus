package webui

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// sessionTTL is the sliding expiration window for panel sessions.
const sessionTTL = 24 * time.Hour

// sessionCookieName is the cookie used to carry the panel session token.
const sessionCookieName = "cpa_panel_session"

// sessionCleanupInterval controls how often expired sessions are purged.
const sessionCleanupInterval = 10 * time.Minute

type sessionEntry struct {
	expiresAt time.Time
}

type sessionManager struct {
	mu       sync.Mutex
	sessions map[string]*sessionEntry
	stop     chan struct{}
	once     sync.Once
}

func newSessionManager() *sessionManager {
	m := &sessionManager{
		sessions: make(map[string]*sessionEntry),
		stop:     make(chan struct{}),
	}
	go m.cleanupLoop()
	return m
}

func (m *sessionManager) cleanupLoop() {
	ticker := time.NewTicker(sessionCleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			m.purge(time.Now())
		case <-m.stop:
			return
		}
	}
}

func (m *sessionManager) purge(now time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for token, entry := range m.sessions {
		if now.After(entry.expiresAt) {
			delete(m.sessions, token)
		}
	}
}

// create mints a fresh random session token with a full TTL.
func (m *sessionManager) create() (string, time.Time) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		// crypto/rand failure is unrecoverable; surface an unusable token rather
		// than degrading to a predictable one.
		return "", time.Time{}
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	expiresAt := time.Now().Add(sessionTTL)
	m.mu.Lock()
	m.sessions[token] = &sessionEntry{expiresAt: expiresAt}
	m.mu.Unlock()
	return token, expiresAt
}

// validate checks the token and slides its expiration forward while active.
func (m *sessionManager) validate(token string) bool {
	_, ok := m.remaining(token)
	return ok
}

// remaining checks the token, slides its expiration forward while active, and
// reports how long the session had left before this activity renewed it —
// that is the honest "how long would this session survive idle" figure.
func (m *sessionManager) remaining(token string) (time.Duration, bool) {
	if token == "" {
		return 0, false
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	entry, ok := m.sessions[token]
	if !ok {
		return 0, false
	}
	if now.After(entry.expiresAt) {
		delete(m.sessions, token)
		return 0, false
	}
	hadLeft := entry.expiresAt.Sub(now)
	entry.expiresAt = now.Add(sessionTTL)
	return hadLeft, true
}

// delete removes a single session (logout).
func (m *sessionManager) delete(token string) {
	m.mu.Lock()
	delete(m.sessions, token)
	m.mu.Unlock()
}

// revokeAll drops every session; used after a password change so other
// browsers must re-authenticate with the new credential.
func (m *sessionManager) revokeAll() {
	m.mu.Lock()
	m.sessions = make(map[string]*sessionEntry)
	m.mu.Unlock()
}

func (m *sessionManager) Close() {
	m.once.Do(func() { close(m.stop) })
}

// setSessionCookie writes the session cookie scoped to the panel.
func setSessionCookie(c *gin.Context, token string, expiresAt time.Time, secure bool) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, token, int(time.Until(expiresAt).Seconds()), "/panel", "", secure, true)
}

// clearSessionCookie expires the session cookie.
func clearSessionCookie(c *gin.Context, secure bool) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(sessionCookieName, "", -1, "/panel", "", secure, true)
}
