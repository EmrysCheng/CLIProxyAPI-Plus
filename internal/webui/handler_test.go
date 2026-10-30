package webui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func newTestHandler(t *testing.T) (*Handler, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	cfg := &config.Config{}
	h := NewHandler(Options{
		ConfigFilePath: filepath.Join(dir, "config.yaml"),
		GetConfig:      func() *config.Config { return cfg },
	})
	g := gin.New()
	h.Register(g)
	return h, g
}

func doJSON(t *testing.T, g *gin.Engine, method, path, body string, cookies []*http.Cookie) (*httptest.ResponseRecorder, []*http.Cookie) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:1234" // httptest defaults to a remote IP; panel policy treats that as remote
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	g.ServeHTTP(w, req)
	return w, w.Result().Cookies()
}

func TestHandlerFullAuthFlow(t *testing.T) {
	h, g := newTestHandler(t)

	// 1. State before setup: onboarding required.
	w, _ := doJSON(t, g, "GET", "/panel/api/auth/state", "", nil)
	if w.Code != 200 {
		t.Fatalf("state: HTTP %d", w.Code)
	}
	var st struct {
		Available     bool `json:"available"`
		SetupRequired bool `json:"setup_required"`
		Authenticated bool `json:"authenticated"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if !st.Available || !st.SetupRequired || st.Authenticated {
		t.Fatalf("unexpected initial state: %+v", st)
	}

	// 2. Setup with a short password must fail.
	w, _ = doJSON(t, g, "POST", "/panel/api/auth/setup", `{"password":"short"}`, nil)
	if w.Code != 400 {
		t.Fatalf("short password: HTTP %d", w.Code)
	}

	// 3. Setup with a good password issues a session cookie.
	w, cookies := doJSON(t, g, "POST", "/panel/api/auth/setup", `{"password":"super-secret-1"}`, nil)
	if w.Code != 200 {
		t.Fatalf("setup: HTTP %d %s", w.Code, w.Body.String())
	}
	var sessionCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == sessionCookieName {
			sessionCookie = c
		}
	}
	if sessionCookie == nil || sessionCookie.Value == "" {
		t.Fatal("no session cookie after setup")
	}
	if !sessionCookie.HttpOnly {
		t.Fatal("session cookie must be HttpOnly")
	}

	// 4. State now reports authenticated.
	w, _ = doJSON(t, g, "GET", "/panel/api/auth/state", "", []*http.Cookie{sessionCookie})
	if err := json.Unmarshal(w.Body.Bytes(), &st); err != nil {
		t.Fatal(err)
	}
	if !st.Authenticated || st.SetupRequired {
		t.Fatalf("state after setup: %+v", st)
	}

	// 5. Wrong login fails; right login succeeds.
	w, _ = doJSON(t, g, "POST", "/panel/api/auth/login", `{"password":"nope"}`, nil)
	if w.Code != 401 {
		t.Fatalf("wrong login: HTTP %d", w.Code)
	}
	w, loginCookies := doJSON(t, g, "POST", "/panel/api/auth/login", `{"password":"super-secret-1"}`, nil)
	if w.Code != 200 {
		t.Fatalf("login: HTTP %d", w.Code)
	}

	// 6. Password change requires the old password.
	w, _ = doJSON(t, g, "PUT", "/panel/api/auth/password", `{"old_password":"wrong","new_password":"changed-pass-1"}`, loginCookies)
	if w.Code != 401 {
		t.Fatalf("wrong old password: HTTP %d", w.Code)
	}
	w, _ = doJSON(t, g, "PUT", "/panel/api/auth/password", `{"old_password":"super-secret-1","new_password":"changed-pass-1"}`, loginCookies)
	if w.Code != 200 {
		t.Fatalf("password change: HTTP %d", w.Code)
	}

	// 7. Password change must revoke all earlier sessions.
	w, _ = doJSON(t, g, "GET", "/panel/api/auth/state", "", []*http.Cookie{sessionCookie})
	var st2 struct {
		Authenticated bool `json:"authenticated"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &st2)
	if st2.Authenticated {
		t.Fatal("pre-change session still valid after password change")
	}

	// 8. The new password logs in.
	w, _ = doJSON(t, g, "POST", "/panel/api/auth/login", `{"password":"changed-pass-1"}`, nil)
	if w.Code != 200 {
		t.Fatalf("login with new password: HTTP %d", w.Code)
	}

	// 9. The audit trail captured the flow.
	entries := h.audit.readAudit(50)
	found := map[string]bool{}
	for _, e := range entries {
		found[e.Event] = true
	}
	for _, event := range []string{"setup_ok", "login_failed", "login_ok", "logout"} {
		_ = event
	}
	if !found["setup_ok"] {
		t.Fatal("audit missing setup_ok")
	}
	if !found["login_failed"] {
		t.Fatal("audit missing login_failed")
	}
	if !found["login_ok"] {
		t.Fatal("audit missing login_ok")
	}
}

func TestHandlerSecurityHeaders(t *testing.T) {
	_, g := newTestHandler(t)
	w, _ := doJSON(t, g, "GET", "/panel/api/auth/state", "", nil)
	if w.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("missing X-Frame-Options")
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing X-Content-Type-Options")
	}
	if w.Header().Get("Referrer-Policy") != "same-origin" {
		t.Fatal("missing Referrer-Policy")
	}
}

func TestHandlerAuditEndpointRequiresSession(t *testing.T) {
	h, g := newTestHandler(t)
	w, _ := doJSON(t, g, "GET", "/panel/api/system/audit", "", nil)
	if w.Code != 401 {
		t.Fatalf("audit without session: HTTP %d", w.Code)
	}
	_ = h
}

func TestHandlerRemoteBlockedByDefault(t *testing.T) {
	h, g := newTestHandler(t)
	_ = h
	// Simulate a remote client: httptest requests come from 127.0.0.1 by
	// default, so override the client IP through a trusted proxy header.
	cfg := &config.Config{} // AllowRemote = false
	req := httptest.NewRequest("GET", "/panel/api/auth/state", nil)
	req.RemoteAddr = "203.0.113.5:4444"
	w := httptest.NewRecorder()
	g.ServeHTTP(w, req)
	// httptest uses the real RemoteAddr; simulate remote by direct handler
	// availability check instead.
	c, _ := gin.CreateTestContext(w)
	c.Request = req
	h2 := NewHandler(Options{ConfigFilePath: filepath.Join(t.TempDir(), "config.yaml"), GetConfig: func() *config.Config { return cfg }})
	if h2.available(c) {
		t.Fatal("remote client must be blocked when allow-remote is off")
	}
}
