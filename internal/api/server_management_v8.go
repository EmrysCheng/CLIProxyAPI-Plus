package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/api/handlers/management"
)

// registerManagementV8Routes defines the v8 contract independently of v0.
// Configuration paths mirror the v8 YAML tree; operational routes use its groups.
func (s *Server) registerManagementV8Routes() {
	const prefix = "/v8/management"

	v8 := s.engine.Group(prefix)
	v8.Use(s.managementAvailabilityMiddleware(), s.mgmt.Middleware(), func(c *gin.Context) {
		c.Set(management.ConfigV8ContextKey, true)
	})
	s.v8ManagementRoutes(v8)
}

// v8ManagementRoutes registers the authenticated v8 management endpoints on the
// given router. It is shared by the /v8/management group (management key auth)
// and the /panel/api/v8/management group (panel session auth); callers attach
// the ConfigV8ContextKey middleware themselves.
func (s *Server) v8ManagementRoutes(g *gin.RouterGroup) {
	g.GET("/config", s.mgmt.ConfigV8)
	g.PUT("/config", s.mgmt.ConfigV8)
	g.PATCH("/config", s.mgmt.ConfigV8)
	g.GET("/config.yaml", s.mgmt.ConfigV8)
	g.PUT("/config.yaml", s.mgmt.ConfigV8)
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		g.Handle(method, "/config/*path", s.mgmt.ConfigV8)
	}

	g.GET("/server/latest-version", s.mgmt.GetLatestVersion)
	g.POST("/requests/api-call", s.mgmt.APICall)
	g.POST("/routing/cooldown/reset", s.mgmt.ResetQuota)
	g.GET("/routing/model-definitions/:channel", s.mgmt.GetStaticModelDefinitions)
	g.POST("/routing/model-definitions/refresh", s.mgmt.RefreshModelDefinitions)
	g.POST("/models/refresh", s.mgmt.RefreshModelDefinitions)

	g.GET("/observability/logs", s.mgmt.GetLogs)
	g.DELETE("/observability/logs", s.mgmt.DeleteLogs)
	g.GET("/observability/logs/errors", s.mgmt.GetRequestErrorLogs)
	g.GET("/observability/logs/errors/:name", s.mgmt.DownloadRequestErrorLog)
	g.GET("/observability/logs/requests/:id", s.mgmt.GetRequestLogByID)
	g.GET("/observability/usage/api-keys", s.mgmt.GetAPIKeyUsage)
	g.GET("/observability/usage/queue", s.mgmt.GetUsageQueue)

	g.GET("/credentials", s.mgmt.ListAuthFiles)
	g.POST("/credentials", s.mgmt.UploadAuthFileV8)
	g.DELETE("/credentials", s.mgmt.DeleteAuthFileV8)
	g.GET("/credentials/models", s.mgmt.GetAuthFileModels)
	g.GET("/credentials/download", s.mgmt.DownloadAuthFile)
	g.PATCH("/credentials/status", s.mgmt.PatchAuthFileStatus)
	g.PATCH("/credentials/fields", s.mgmt.PatchAuthFileFields)
	g.POST("/credentials/refresh", s.mgmt.RefreshAuthFiles)
	g.POST("/oauth/import", s.mgmt.ImportOAuthV8)
	g.GET("/oauth/auth-url", s.mgmt.StartOAuthV8)
	g.POST("/oauth/auth-url", s.mgmt.StartOAuthV8)
	g.POST("/oauth/siwc/bind", s.mgmt.StartSIWCBind)
	g.GET("/oauth/siwc/status", s.mgmt.GetSIWCStatus)
	g.GET("/credentials/siwc/status", s.mgmt.GetSIWCStatus)
	g.GET("/oauth/status", s.mgmt.GetAuthStatus)
	g.DELETE("/oauth/session", s.mgmt.CancelAuthSession)

	g.GET("/plugins", s.mgmt.ListPlugins)
	g.DELETE("/plugins/:id", s.mgmt.DeletePlugin)
	g.GET("/plugins/store", s.mgmt.ListPluginStore)
	g.POST("/plugins/store/:id/install", s.mgmt.InstallPluginFromStore)
	g.GET("/plugins/:id/quota", s.mgmt.GetPluginQuota)
	g.POST("/plugins/:id/quota", s.mgmt.FetchPluginQuota)
	g.DELETE("/plugins/:id/quota", s.mgmt.ResetPluginQuota)
}
