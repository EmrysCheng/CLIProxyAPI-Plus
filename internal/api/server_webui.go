package api

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/api/handlers/management"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/webui"
	log "github.com/sirupsen/logrus"
)

// panelVersionHeaders mirrors the identity headers the management middleware
// attaches, so the panel can display the running build version.
func panelVersionHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-CPA-VERSION", buildinfo.Version)
		c.Header("X-CPA-COMMIT", buildinfo.Commit)
		c.Header("X-CPA-BUILD-DATE", buildinfo.BuildDate)
		c.Next()
	}
}

// registerWebUI attaches the built-in web panel under /panel. The panel
// serves its own session-authenticated API at /panel/api/auth/* and mirrors
// the v0/v8 management route tables at /panel/api/{v0,v8}/management/* so the
// embedded UI can operate every management feature without a management key.
func (s *Server) registerWebUI() {
	if s == nil || s.engine == nil || s.mgmt == nil {
		return
	}
	s.webui = webui.NewHandler(webui.Options{
		ConfigFilePath: s.configFilePath,
		GetConfig:      s.getConfig,
		RestartNow: func() {
			log.Info("panel requested shutdown for update/restart; handing over to replacement process")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := s.Stop(ctx); err != nil {
				log.WithError(err).Warn("graceful stop during panel restart failed")
			}
			os.Exit(0)
		},
	})
	s.webui.Register(s.engine)

	panelV0 := s.engine.Group("/panel/api/v0/management")
	panelV0.Use(s.webui.SessionMiddleware(), webui.SecurityHeaders(), panelVersionHeaders())
	s.v0ManagementRoutes(panelV0)

	panelV8 := s.engine.Group("/panel/api/v8/management")
	panelV8.Use(s.webui.SessionMiddleware(), webui.SecurityHeaders(), panelVersionHeaders(), func(c *gin.Context) {
		c.Set(management.ConfigV8ContextKey, true)
	})
	s.v8ManagementRoutes(panelV8)

	baseNoRoute := s.pluginManagementNoRoute
	s.engine.NoRoute(func(c *gin.Context) {
		if c != nil && c.Request != nil && c.Request.URL != nil {
			path := c.Request.URL.Path
			if path == "/panel" {
				target := "/panel/"
				if c.Request.URL.RawQuery != "" {
					target += "?" + c.Request.URL.RawQuery
				}
				c.Redirect(http.StatusMovedPermanently, target)
				return
			}
			if strings.HasPrefix(path, "/panel/") {
				if strings.HasPrefix(path, "/panel/api/") {
					c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "not found"})
					return
				}
				s.webui.ServeStatic(c)
				return
			}
		}
		baseNoRoute(c)
	})
}
