package webui

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/updater"
	log "github.com/sirupsen/logrus"
)

//go:embed all:static
var staticFS embed.FS

// minPasswordLength is the shortest accepted panel password.
const minPasswordLength = 8

// panelSessionRemainingKey carries the pre-renewal session TTL through the
// gin context so /auth/state can report it.
const panelSessionRemainingKey = "panel.session_remaining"

// Options configures the web panel handler.
type Options struct {
	// ConfigFilePath is the path to config.yaml; panel credentials are stored
	// alongside it as panel-auth.json.
	ConfigFilePath string
	// GetConfig returns the current runtime configuration.
	GetConfig func() *config.Config
	// RestartNow, when set, performs a graceful shutdown and process exit so
	// the updater's replacement process can take over.
	RestartNow func()
}

// Handler serves the embedded panel SPA and its session-authenticated API.
type Handler struct {
	opts     Options
	creds    *credentialStore
	sessions *sessionManager
	limiter  *loginLimiter
	audit    *auditWriter
	// updateMu serializes update operations; a restart hook tears the
	// process down after the apply response has been flushed.
	updateMu   chan struct{}
	restartNow func()
}

// NewHandler builds the panel handler. Call Register on a gin engine to attach
// the /panel/api/auth routes; management proxy routes and static fallback are
// wired by the api package.
func NewHandler(opts Options) *Handler {
	if api := os.Getenv("CPA_UPDATER_RELEASE_API"); api != "" {
		// Test hook: point the updater at a local fake release server.
		updater.SetEndpoints(api, os.Getenv("CPA_UPDATER_DOWNLOAD_BASE"))
	}
	h := &Handler{
		opts:       opts,
		creds:      newCredentialStore(opts.ConfigFilePath),
		sessions:   newSessionManager(),
		limiter:    newLoginLimiter(),
		audit:      newAuditWriter(opts.ConfigFilePath),
		updateMu:   make(chan struct{}, 1),
		restartNow: opts.RestartNow,
	}
	h.creds.load()
	return h
}

// Close releases background goroutines.
func (h *Handler) Close() {
	h.sessions.Close()
	h.limiter.Close()
}

func (h *Handler) getConfig() *config.Config {
	if h == nil || h.opts.GetConfig == nil {
		return nil
	}
	return h.opts.GetConfig()
}

// envManagementPassword mirrors the upstream MANAGEMENT_PASSWORD behaviour:
// when the env secret is set, remote management access is implicitly allowed.
func envManagementPassword() string {
	value, _ := os.LookupEnv("MANAGEMENT_PASSWORD")
	return strings.TrimSpace(value)
}

func isLocalClient(c *gin.Context) bool {
	ip := c.ClientIP()
	return ip == "127.0.0.1" || ip == "::1"
}

// remoteAllowed reports whether non-local clients may reach the panel,
// following the same policy as the management API.
func remoteAllowed(cfg *config.Config) bool {
	if cfg != nil && cfg.RemoteManagement.AllowRemote {
		return true
	}
	return envManagementPassword() != ""
}

// available enforces the panel-wide availability policy. It aborts the
// request and returns false when the panel must not be served.
func (h *Handler) available(c *gin.Context) bool {
	cfg := h.getConfig()
	if cfg == nil || cfg.Home.Enabled || cfg.RemoteManagement.DisableControlPanel {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "panel disabled"})
		return false
	}
	if !isLocalClient(c) && !remoteAllowed(cfg) {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "remote panel access disabled; set remote-management.allow-remote=true to enable"})
		return false
	}
	return true
}

// SessionMiddleware guards panel API routes with the session cookie. Non-GET
// requests (plus sensitive reads) are written to the audit log together with
// the response status.
func (h *Handler) SessionMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !h.available(c) {
			return
		}
		token, err := c.Cookie(sessionCookieName)
		remaining, valid := h.sessions.remaining(token)
		if err != nil || !valid {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
			return
		}
		c.Set(panelSessionRemainingKey, remaining)
		c.Next()
		if h.audit != nil && shouldAudit(c.Request.Method, c.Request.URL.Path) {
			h.audit.write(AuditEntry{
				Time:   time.Now().UTC().Format(time.RFC3339),
				IP:     c.ClientIP(),
				Method: c.Request.Method,
				Path:   c.Request.URL.Path,
				Status: c.Writer.Status(),
			})
		}
	}
}

func (h *Handler) secureCookie() bool {
	cfg := h.getConfig()
	return cfg != nil && cfg.TLS.Enable
}

// panelSecurityHeaders hardens browser-facing panel responses: the management
// SPA must not be framable (clickjacking) and its API responses must not be
// sniffed or leaked via referrers.
func panelSecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Frame-Options", "DENY")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Referrer-Policy", "same-origin")
		c.Next()
	}
}

// Register attaches the panel authentication endpoints.
func (h *Handler) Register(g *gin.Engine) {
	// Ensure both /panel and /panel/ are accessible with seamless permanent redirection
	g.GET("/panel", func(c *gin.Context) {
		target := "/panel/"
		if c.Request != nil && c.Request.URL != nil && c.Request.URL.RawQuery != "" {
			target += "?" + c.Request.URL.RawQuery
		}
		c.Redirect(http.StatusMovedPermanently, target)
	})
	g.HEAD("/panel", func(c *gin.Context) {
		c.Redirect(http.StatusMovedPermanently, "/panel/")
	})
	g.GET("/panel/", h.ServeStatic)
	g.HEAD("/panel/", h.ServeStatic)

	panel := g.Group("/panel", panelSecurityHeaders())
	auth := panel.Group("/api/auth")
	{
		auth.GET("/state", h.GetAuthState)
		auth.POST("/setup", h.PostAuthSetup)
		auth.POST("/login", h.PostAuthLogin)
		auth.POST("/logout", h.PostAuthLogout)
		auth.PUT("/password", h.SessionMiddleware(), h.PutAuthPassword)
	}
	system := panel.Group("/api/system", h.SessionMiddleware())
	{
		system.GET("/update/status", h.GetUpdateStatus)
		system.POST("/update/apply", h.PostUpdateApply)
		system.POST("/restart", h.PostRestart)
		system.GET("/audit", h.GetAuditLog)
	}
}

// githubToken returns the configured token used to raise GitHub API limits.
func (h *Handler) githubToken() string {
	if cfg := h.getConfig(); cfg != nil {
		return cfg.GitHubToken
	}
	return ""
}

// GetUpdateStatus reports the running build versus the latest upstream release.
func (h *Handler) GetUpdateStatus(c *gin.Context) {
	status, err := updater.Check(c.Request.Context(), h.githubToken(), buildinfo.Version, buildinfo.Commit, buildinfo.BuildDate)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, status)
}

// PostUpdateApply downloads the latest release, verifies and swaps the binary,
// then schedules a graceful restart. The HTTP response is flushed first so the
// browser learns the outcome before the process exits.
func (h *Handler) PostUpdateApply(c *gin.Context) {
	select {
	case h.updateMu <- struct{}{}:
		defer func() { <-h.updateMu }()
	default:
		c.JSON(http.StatusConflict, gin.H{"error": "an update is already in progress"})
		return
	}
	status, err := updater.Check(c.Request.Context(), h.githubToken(), buildinfo.Version, buildinfo.Commit, buildinfo.BuildDate)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if err := updater.Apply(c.Request.Context(), h.githubToken(), status, func(stage string) {
		log.Infof("panel update: %s", stage)
	}); err != nil {
		log.WithError(err).Error("panel update failed")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	plan, err := updater.Plan()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"status": "updated", "restarting": false, "message": "binary replaced; restart manually to load it"})
		return
	}
	if err := updater.Restart(plan); err != nil {
		log.WithError(err).Error("panel update: restart scheduling failed")
		c.JSON(http.StatusOK, gin.H{"status": "updated", "restarting": false, "message": "binary replaced; restart manually to load it"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "updated", "restarting": true})
	// Give the client a moment to receive the response, then hand over to the
	// replacement process spawned by the restart supervisor.
	h.scheduleShutdown()
}

// PostRestart gracefully stops the server so the restart supervisor can start
// the same binary again.
func (h *Handler) PostRestart(c *gin.Context) {
	select {
	case h.updateMu <- struct{}{}:
		defer func() { <-h.updateMu }()
	default:
		c.JSON(http.StatusConflict, gin.H{"error": "another restart/update is in progress"})
		return
	}
	plan, err := updater.Plan()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := updater.Restart(plan); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "restarting"})
	h.scheduleShutdown()
}

func (h *Handler) scheduleShutdown() {
	if h.restartNow == nil {
		log.Warn("panel restart requested but no restart hook is configured")
		return
	}
	hook := h.restartNow
	go func() {
		// Let the HTTP response drain before tearing everything down.
		time.Sleep(1200 * time.Millisecond)
		hook()
	}()
}

// GetAuthState reports panel availability and whether onboarding is needed.
func (h *Handler) GetAuthState(c *gin.Context) {
	cfg := h.getConfig()
	if cfg == nil || cfg.Home.Enabled || cfg.RemoteManagement.DisableControlPanel {
		c.JSON(http.StatusOK, gin.H{"available": false, "setup_required": false, "authenticated": false})
		return
	}
	remote := remoteAllowed(cfg)
	local := isLocalClient(c)
	token, _ := c.Cookie(sessionCookieName)
	remaining, authenticated := h.sessions.remaining(token)
	c.JSON(http.StatusOK, gin.H{
		"available":                 true,
		"remote_allowed":            remote,
		"local_client":              local,
		"setup_required":            h.creds.SetupRequired(),
		"authenticated":             authenticated,
		"session_remaining_seconds": int(remaining.Seconds()),
	})
}

// PostAuthSetup creates the panel administrator password (first run only).
func (h *Handler) PostAuthSetup(c *gin.Context) {
	if !h.available(c) {
		return
	}
	if !h.enforceLoginWindow(c) {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Password) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password is required"})
		return
	}
	if len(req.Password) < minPasswordLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 8 characters"})
		return
	}
	if err := h.creds.Setup(req.Password); err != nil {
		h.limiter.Fail(c.ClientIP())
		h.recordAuthEvent(c, "setup_failed")
		log.WithError(err).Warn("panel setup rejected")
		c.JSON(http.StatusConflict, gin.H{"error": "panel already configured; use the login page"})
		return
	}
	h.limiter.Reset(c.ClientIP())
	h.recordAuthEvent(c, "setup_ok")
	h.startSession(c)
	log.Info("panel administrator credential created via onboarding")
}

// PostAuthLogin verifies the panel password and issues a session cookie.
func (h *Handler) PostAuthLogin(c *gin.Context) {
	if !h.available(c) {
		return
	}
	if !h.enforceLoginWindow(c) {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password is required"})
		return
	}
	if h.creds.SetupRequired() || !h.creds.Verify(req.Password) {
		h.limiter.Fail(c.ClientIP())
		h.recordAuthEvent(c, "login_failed")
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid password"})
		return
	}
	h.limiter.Reset(c.ClientIP())
	h.recordAuthEvent(c, "login_ok")
	h.startSession(c)
}

// PostAuthLogout drops the current session.
func (h *Handler) PostAuthLogout(c *gin.Context) {
	if token, err := c.Cookie(sessionCookieName); err == nil && token != "" {
		h.sessions.delete(token)
	}
	h.recordAuthEvent(c, "logout")
	clearSessionCookie(c, h.secureCookie())
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetAuditLog returns recent panel audit entries (newest first).
func (h *Handler) GetAuditLog(c *gin.Context) {
	limit := 200
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 1000 {
			limit = n
		}
	}
	c.JSON(http.StatusOK, gin.H{"entries": h.audit.readAudit(limit)})
}

// PutAuthPassword rotates the panel password after re-verifying the old one.
func (h *Handler) PutAuthPassword(c *gin.Context) {
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.OldPassword == "" || req.NewPassword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "old_password and new_password are required"})
		return
	}
	if len(req.NewPassword) < minPasswordLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new password must be at least 8 characters"})
		return
	}
	if err := h.creds.Update(req.OldPassword, req.NewPassword); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	// Every existing session is void once the credential rotates; the current
	// client re-authenticated moments ago, so re-issue a fresh session.
	h.sessions.revokeAll()
	h.startSession(c)
	log.Info("panel administrator password updated")
}

func (h *Handler) enforceLoginWindow(c *gin.Context) bool {
	if remaining, blocked := h.limiter.Blocked(c.ClientIP()); blocked {
		c.JSON(http.StatusForbidden, gin.H{"error": "too many failed attempts; try again in " + remaining.String()})
		return false
	}
	return true
}

func (h *Handler) startSession(c *gin.Context) {
	token, expiresAt := h.sessions.create()
	if token == "" || expiresAt.IsZero() {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
		return
	}
	setSessionCookie(c, token, expiresAt, h.secureCookie())
	c.JSON(http.StatusOK, gin.H{"authenticated": true, "expires_at": expiresAt.Format(time.RFC3339)})
}

// SecurityHeaders exposes the panel hardening headers for the api package to
// apply on the management proxy groups.
func SecurityHeaders() gin.HandlerFunc { return panelSecurityHeaders() }

// ServeStatic serves the embedded SPA from the NoRoute fallback, including
// the index.html history fallback for client-side routes.
func (h *Handler) ServeStatic(c *gin.Context) {
	panelSecurityHeaders()(c)
	if !h.available(c) {
		return
	}
	path := strings.TrimPrefix(c.Request.URL.Path, "/panel")
	path = strings.TrimPrefix(path, "/")
	if path == "" {
		path = "index.html"
	}
	target, err := fs.Sub(staticFS, "static")
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	if path != "index.html" {
		if f, err := target.Open(path); err == nil {
			info, statErr := f.Stat()
			if statErr == nil && !info.IsDir() {
				if seeker, ok := f.(io.ReadSeeker); ok {
					// Hashed Vite asset names are immutable; index.html never caches.
					c.Header("Cache-Control", "public, max-age=31536000, immutable")
					http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), seeker)
					_ = f.Close()
					return
				}
			}
			_ = f.Close()
		}
	}
	index, err := fs.ReadFile(target, "index.html")
	if err != nil {
		c.String(http.StatusNotFound, "panel build missing; run the web build first")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "text/html; charset=utf-8", index)
}
