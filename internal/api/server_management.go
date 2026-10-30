package api

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/managementasset"
	log "github.com/sirupsen/logrus"
)

func (s *Server) registerManagementRoutes() {
	if s == nil || s.engine == nil || s.mgmt == nil {
		return
	}
	if !s.managementRoutesRegistered.CompareAndSwap(false, true) {
		return
	}

	log.Info("management routes registered after secret key configuration")

	s.registerManagementV8Routes()

	mgmt := s.engine.Group("/v0/management")
	mgmt.Use(s.managementAvailabilityMiddleware(), s.mgmt.Middleware())
	s.v0ManagementRoutes(mgmt)
}

// v0ManagementRoutes registers the authenticated v0 management endpoints on the
// given router. It is shared by the /v0/management group (management key auth)
// and the /panel/api/v0/management group (panel session auth) so both surfaces
// expose exactly the same handler set.
func (s *Server) v0ManagementRoutes(g *gin.RouterGroup) {
	{
		g.GET("/config", s.mgmt.GetConfig)
		g.GET("/config.yaml", s.mgmt.GetConfigYAML)
		g.PUT("/config.yaml", s.mgmt.PutConfigYAML)
		g.GET("/latest-version", s.mgmt.GetLatestVersion)
		g.GET("/plugins", s.mgmt.ListPlugins)
		g.GET("/plugin-store", s.mgmt.ListPluginStore)
		g.POST("/plugin-store/:id/install", s.mgmt.InstallPluginFromStore)
		g.DELETE("/plugins/:id", s.mgmt.DeletePlugin)
		g.PATCH("/plugins/:id/enabled", s.mgmt.PatchPluginEnabled)
		g.GET("/plugins/:id/config", s.mgmt.GetPluginConfig)
		g.PUT("/plugins/:id/config", s.mgmt.PutPluginConfig)
		g.PATCH("/plugins/:id/config", s.mgmt.PatchPluginConfig)
		g.GET("/plugins/:id/quota", s.mgmt.GetPluginQuota)
		g.POST("/plugins/:id/quota", s.mgmt.FetchPluginQuota)
		g.DELETE("/plugins/:id/quota", s.mgmt.ResetPluginQuota)
		g.POST("/plugins/:id/quota/reset", s.mgmt.ResetPluginQuota)

		g.GET("/debug", s.mgmt.GetDebug)
		g.PUT("/debug", s.mgmt.PutDebug)
		g.PATCH("/debug", s.mgmt.PutDebug)

		g.GET("/logging-to-file", s.mgmt.GetLoggingToFile)
		g.PUT("/logging-to-file", s.mgmt.PutLoggingToFile)
		g.PATCH("/logging-to-file", s.mgmt.PutLoggingToFile)

		g.GET("/logs-max-total-size-mb", s.mgmt.GetLogsMaxTotalSizeMB)
		g.PUT("/logs-max-total-size-mb", s.mgmt.PutLogsMaxTotalSizeMB)
		g.PATCH("/logs-max-total-size-mb", s.mgmt.PutLogsMaxTotalSizeMB)

		g.GET("/error-logs-max-files", s.mgmt.GetErrorLogsMaxFiles)
		g.PUT("/error-logs-max-files", s.mgmt.PutErrorLogsMaxFiles)
		g.PATCH("/error-logs-max-files", s.mgmt.PutErrorLogsMaxFiles)

		g.GET("/usage-statistics-enabled", s.mgmt.GetUsageStatisticsEnabled)
		g.PUT("/usage-statistics-enabled", s.mgmt.PutUsageStatisticsEnabled)
		g.PATCH("/usage-statistics-enabled", s.mgmt.PutUsageStatisticsEnabled)

		g.GET("/proxy-url", s.mgmt.GetProxyURL)
		g.PUT("/proxy-url", s.mgmt.PutProxyURL)
		g.PATCH("/proxy-url", s.mgmt.PutProxyURL)
		g.DELETE("/proxy-url", s.mgmt.DeleteProxyURL)

		g.POST("/api-call", s.mgmt.APICall)

		g.GET("/quota-exceeded/switch-project", s.mgmt.GetSwitchProject)
		g.PUT("/quota-exceeded/switch-project", s.mgmt.PutSwitchProject)
		g.PATCH("/quota-exceeded/switch-project", s.mgmt.PutSwitchProject)

		g.GET("/quota-exceeded/switch-preview-model", s.mgmt.GetSwitchPreviewModel)
		g.PUT("/quota-exceeded/switch-preview-model", s.mgmt.PutSwitchPreviewModel)
		g.PATCH("/quota-exceeded/switch-preview-model", s.mgmt.PutSwitchPreviewModel)
		g.POST("/reset-quota", s.mgmt.ResetQuota)

		g.GET("/quota/providers", s.mgmt.GetQuotaProviders)
		g.POST("/quota/fetch", s.mgmt.FetchCredentialQuota)
		g.POST("/quota/reset", s.mgmt.ResetCredentialQuota)

		g.GET("/api-keys", s.mgmt.GetAPIKeys)
		g.PUT("/api-keys", s.mgmt.PutAPIKeys)
		g.PATCH("/api-keys", s.mgmt.PatchAPIKeys)
		g.DELETE("/api-keys", s.mgmt.DeleteAPIKeys)
		g.GET("/api-key-usage", s.mgmt.GetAPIKeyUsage)
		g.GET("/usage-queue", s.mgmt.GetUsageQueue)

		g.GET("/gemini-api-key", s.mgmt.GetGeminiKeys)
		g.PUT("/gemini-api-key", s.mgmt.PutGeminiKeys)
		g.PATCH("/gemini-api-key", s.mgmt.PatchGeminiKey)
		g.DELETE("/gemini-api-key", s.mgmt.DeleteGeminiKey)

		g.GET("/interactions-api-key", s.mgmt.GetInteractionsKeys)
		g.PUT("/interactions-api-key", s.mgmt.PutInteractionsKeys)
		g.PATCH("/interactions-api-key", s.mgmt.PatchInteractionsKey)
		g.DELETE("/interactions-api-key", s.mgmt.DeleteInteractionsKey)

		g.GET("/logs", s.mgmt.GetLogs)
		g.DELETE("/logs", s.mgmt.DeleteLogs)
		g.GET("/request-error-logs", s.mgmt.GetRequestErrorLogs)
		g.GET("/request-error-logs/:name", s.mgmt.DownloadRequestErrorLog)
		g.GET("/request-log-by-id/:id", s.mgmt.GetRequestLogByID)
		g.GET("/request-log", s.mgmt.GetRequestLog)
		g.PUT("/request-log", s.mgmt.PutRequestLog)
		g.PATCH("/request-log", s.mgmt.PutRequestLog)
		g.GET("/ws-auth", s.mgmt.GetWebsocketAuth)
		g.PUT("/ws-auth", s.mgmt.PutWebsocketAuth)
		g.PATCH("/ws-auth", s.mgmt.PutWebsocketAuth)

		g.GET("/request-retry", s.mgmt.GetRequestRetry)
		g.PUT("/request-retry", s.mgmt.PutRequestRetry)
		g.PATCH("/request-retry", s.mgmt.PutRequestRetry)
		g.GET("/max-retry-credentials", s.mgmt.GetMaxRetryCredentials)
		g.PUT("/max-retry-credentials", s.mgmt.PutMaxRetryCredentials)
		g.PATCH("/max-retry-credentials", s.mgmt.PutMaxRetryCredentials)
		g.GET("/max-retry-interval", s.mgmt.GetMaxRetryInterval)
		g.PUT("/max-retry-interval", s.mgmt.PutMaxRetryInterval)
		g.PATCH("/max-retry-interval", s.mgmt.PutMaxRetryInterval)

		g.GET("/force-model-prefix", s.mgmt.GetForceModelPrefix)
		g.PUT("/force-model-prefix", s.mgmt.PutForceModelPrefix)
		g.PATCH("/force-model-prefix", s.mgmt.PutForceModelPrefix)

		g.GET("/routing/strategy", s.mgmt.GetRoutingStrategy)
		g.PUT("/routing/strategy", s.mgmt.PutRoutingStrategy)
		g.PATCH("/routing/strategy", s.mgmt.PutRoutingStrategy)

		g.GET("/claude-api-key", s.mgmt.GetClaudeKeys)
		g.PUT("/claude-api-key", s.mgmt.PutClaudeKeys)
		g.PATCH("/claude-api-key", s.mgmt.PatchClaudeKey)
		g.DELETE("/claude-api-key", s.mgmt.DeleteClaudeKey)

		g.GET("/codex-api-key", s.mgmt.GetCodexKeys)
		g.PUT("/codex-api-key", s.mgmt.PutCodexKeys)
		g.PATCH("/codex-api-key", s.mgmt.PatchCodexKey)
		g.DELETE("/codex-api-key", s.mgmt.DeleteCodexKey)

		g.GET("/xai-api-key", s.mgmt.GetXAIKeys)
		g.PUT("/xai-api-key", s.mgmt.PutXAIKeys)
		g.PATCH("/xai-api-key", s.mgmt.PatchXAIKey)
		g.DELETE("/xai-api-key", s.mgmt.DeleteXAIKey)

		g.GET("/meta-api-key", s.mgmt.GetMetaKeys)
		g.PUT("/meta-api-key", s.mgmt.PutMetaKeys)
		g.PATCH("/meta-api-key", s.mgmt.PatchMetaKey)
		g.DELETE("/meta-api-key", s.mgmt.DeleteMetaKey)

		g.GET("/openai-compatibility", s.mgmt.GetOpenAICompat)
		g.PUT("/openai-compatibility", s.mgmt.PutOpenAICompat)
		g.PATCH("/openai-compatibility", s.mgmt.PatchOpenAICompat)
		g.DELETE("/openai-compatibility", s.mgmt.DeleteOpenAICompat)

		g.GET("/vertex-api-key", s.mgmt.GetVertexCompatKeys)
		g.PUT("/vertex-api-key", s.mgmt.PutVertexCompatKeys)
		g.PATCH("/vertex-api-key", s.mgmt.PatchVertexCompatKey)
		g.DELETE("/vertex-api-key", s.mgmt.DeleteVertexCompatKey)

		g.GET("/oauth-excluded-models", s.mgmt.GetOAuthExcludedModels)
		g.PUT("/oauth-excluded-models", s.mgmt.PutOAuthExcludedModels)
		g.PATCH("/oauth-excluded-models", s.mgmt.PatchOAuthExcludedModels)
		g.DELETE("/oauth-excluded-models", s.mgmt.DeleteOAuthExcludedModels)

		g.GET("/oauth-model-alias", s.mgmt.GetOAuthModelAlias)
		g.PUT("/oauth-model-alias", s.mgmt.PutOAuthModelAlias)
		g.PATCH("/oauth-model-alias", s.mgmt.PatchOAuthModelAlias)
		g.DELETE("/oauth-model-alias", s.mgmt.DeleteOAuthModelAlias)

		g.GET("/oauth-request-scoped-errors", s.mgmt.GetOAuthRequestScopedErrors)
		g.PUT("/oauth-request-scoped-errors", s.mgmt.PutOAuthRequestScopedErrors)
		g.PATCH("/oauth-request-scoped-errors", s.mgmt.PatchOAuthRequestScopedErrors)
		g.DELETE("/oauth-request-scoped-errors", s.mgmt.DeleteOAuthRequestScopedErrors)

		g.GET("/auth-files", s.mgmt.ListAuthFiles)
		g.GET("/auth-files/models", s.mgmt.GetAuthFileModels)
		g.GET("/model-definitions/:channel", s.mgmt.GetStaticModelDefinitions)
		g.GET("/auth-files/download", s.mgmt.DownloadAuthFile)
		g.POST("/auth-files", s.mgmt.UploadAuthFile)
		g.DELETE("/auth-files", s.mgmt.DeleteAuthFile)
		g.PATCH("/auth-files/status", s.mgmt.PatchAuthFileStatus)
		g.PATCH("/auth-files/fields", s.mgmt.PatchAuthFileFields)
		g.POST("/auth-files/refresh", s.mgmt.RefreshAuthFiles)
		g.POST("/vertex/import", s.mgmt.ImportVertexCredential)

		g.GET("/anthropic-auth-url", s.mgmt.RequestAnthropicToken)
		g.GET("/codex-auth-url", s.mgmt.RequestCodexToken)
		g.GET("/antigravity-auth-url", s.mgmt.RequestAntigravityToken)
		g.GET("/kimi-auth-url", s.mgmt.RequestKimiToken)
		g.GET("/kimi-ai-auth-url", s.mgmt.RequestKimiAIToken)
		g.GET("/xai-auth-url", s.mgmt.RequestXAIToken)
		g.GET("/devin-auth-url", s.mgmt.RequestDevinToken)
		g.GET("/meta-auth-url", s.mgmt.RequestMetaToken)
		g.GET("/get-auth-status", s.mgmt.GetAuthStatus)
		g.DELETE("/oauth-session", s.mgmt.CancelAuthSession)
	}
}

func (s *Server) managementAvailabilityMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !s.managementAvailable(c) {
			return
		}
		c.Next()
	}
}

func (s *Server) managementAvailable(c *gin.Context) bool {
	cfg := s.getConfig()
	if s == nil || cfg == nil {
		c.AbortWithStatus(http.StatusNotFound)
		return false
	}
	if cfg.Home.Enabled {
		c.AbortWithStatus(http.StatusNotFound)
		return false
	}
	if !s.managementRoutesEnabled.Load() {
		c.AbortWithStatus(http.StatusNotFound)
		return false
	}
	return true
}

func (s *Server) refreshPluginManagementRoutes() {
	if s == nil || s.pluginHost == nil || s.engine == nil {
		return
	}
	s.pluginHost.RegisterManagementRoutes(context.Background(), s.registeredManagementRouteKeys())
}

// RefreshPluginManagementRoutes rebuilds plugin-owned Management API routes.
func (s *Server) RefreshPluginManagementRoutes() {
	s.refreshPluginManagementRoutes()
}

func (s *Server) registeredManagementRouteKeys() map[string]struct{} {
	out := make(map[string]struct{})
	if s == nil || s.engine == nil {
		return out
	}
	for _, route := range s.engine.Routes() {
		if strings.HasPrefix(route.Path, "/v0/management/") || route.Path == "/v0/management" {
			out[strings.ToUpper(strings.TrimSpace(route.Method))+" "+route.Path] = struct{}{}
		}
	}
	return out
}

func (s *Server) pluginManagementNoRoute(c *gin.Context) {
	if s == nil || c == nil || c.Request == nil || c.Request.URL == nil {
		if c != nil {
			c.AbortWithStatus(http.StatusNotFound)
		}
		return
	}
	path := c.Request.URL.Path
	if strings.HasPrefix(path, "/v0/resource/plugins/") {
		s.pluginResourceNoRoute(c)
		return
	}
	if path != "/v0/management" && !strings.HasPrefix(path, "/v0/management/") {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if s.pluginHost == nil || s.mgmt == nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if !s.managementAvailable(c) {
		return
	}
	s.mgmt.Middleware()(c)
	if c.IsAborted() {
		return
	}
	if s.mgmt.ServePluginAuthURL(c) {
		c.Abort()
		return
	}
	if s.pluginHost.ServeManagementHTTP(c.Writer, c.Request) {
		c.Abort()
		return
	}
	c.AbortWithStatus(http.StatusNotFound)
}

func (s *Server) pluginResourceNoRoute(c *gin.Context) {
	if s == nil || c == nil || c.Request == nil || c.Request.URL == nil {
		if c != nil {
			c.AbortWithStatus(http.StatusNotFound)
		}
		return
	}
	cfg := s.getConfig()
	if cfg == nil || cfg.Home.Enabled || s.pluginHost == nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if s.pluginHost.ServeResourceHTTP(c.Writer, c.Request) {
		c.Abort()
		return
	}
	c.AbortWithStatus(http.StatusNotFound)
}

func (s *Server) serveManagementControlPanel(c *gin.Context) {
	cfg := s.getConfig()
	if cfg == nil || cfg.Home.Enabled || cfg.RemoteManagement.DisableControlPanel {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	filePath := managementasset.FilePath(s.configFilePath)
	if strings.TrimSpace(filePath) == "" {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	if _, err := os.Stat(filePath); err != nil {
		if os.IsNotExist(err) {
			// Synchronously ensure management.html is available with a detached context.
			// Control panel bootstrap should not be canceled by client disconnects.
			if !managementasset.EnsureLatestManagementHTML(context.Background(), managementasset.StaticDir(s.configFilePath), cfg.ProxyURL, cfg.RemoteManagement.PanelGitHubRepository) {
				c.AbortWithStatus(http.StatusNotFound)
				return
			}
		} else {
			log.WithError(err).Error("failed to stat management control panel asset")
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
	}

	c.File(filePath)
}
