package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/webui"
)

func TestPanelTrailingSlashRedirect(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()

	h := webui.NewHandler(webui.Options{
		GetConfig: func() *config.Config {
			return &config.Config{}
		},
	})
	h.Register(engine)

	engine.NoRoute(func(c *gin.Context) {
		if c.Request.URL.Path == "/panel" {
			target := "/panel/"
			if c.Request.URL.RawQuery != "" {
				target += "?" + c.Request.URL.RawQuery
			}
			c.Redirect(http.StatusMovedPermanently, target)
			return
		}
		c.Status(http.StatusNotFound)
	})

	// Test 1: GET /panel without trailing slash -> 301 to /panel/
	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodGet, "/panel", nil)
	engine.ServeHTTP(w1, req1)

	if w1.Code != http.StatusMovedPermanently {
		t.Fatalf("GET /panel status = %d, want %d", w1.Code, http.StatusMovedPermanently)
	}
	if loc := w1.Header().Get("Location"); loc != "/panel/" {
		t.Fatalf("GET /panel Location = %q, want /panel/", loc)
	}

	// Test 2: GET /panel?foo=bar without trailing slash -> 301 to /panel/?foo=bar
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/panel?foo=bar", nil)
	engine.ServeHTTP(w2, req2)

	if w2.Code != http.StatusMovedPermanently {
		t.Fatalf("GET /panel?foo=bar status = %d, want %d", w2.Code, http.StatusMovedPermanently)
	}
	if loc := w2.Header().Get("Location"); loc != "/panel/?foo=bar" {
		t.Fatalf("GET /panel?foo=bar Location = %q, want /panel/?foo=bar", loc)
	}
}
