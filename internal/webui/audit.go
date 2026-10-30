package webui

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// auditFileMaxBytes caps the audit log before rotation; the previous file is
// kept as panel-audit.log.1 so operators retain some history.
var auditFileMaxBytes = int64(5 << 20)

// AuditEntry is one line of the panel audit log.
type AuditEntry struct {
	Time   string `json:"time"`
	IP     string `json:"ip"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Status int    `json:"status"`
	Event  string `json:"event,omitempty"`
}

type auditWriter struct {
	mu   sync.Mutex
	path string
}

func newAuditWriter(configFilePath string) *auditWriter {
	dir := filepath.Dir(configFilePath)
	if dir == "" {
		dir = "."
	}
	return &auditWriter{path: filepath.Join(dir, "panel-audit.log")}
}

// write appends one entry as a JSON line, rotating the file when oversized.
func (a *auditWriter) write(entry AuditEntry) {
	if a == nil {
		return
	}
	raw, err := json.Marshal(entry)
	if err != nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if info, errStat := os.Stat(a.path); errStat == nil && info.Size() > auditFileMaxBytes {
		_ = os.Rename(a.path, a.path+".1")
	}
	f, err := os.OpenFile(a.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()
	_, _ = f.Write(append(raw, '\n'))
}

// auditLogger marks the request so the session middleware records it after
// the handler chain completes with the real response status.
const auditLoggedKey = "panel.audit.logged"

// readAudit returns the last limit entries, newest first.
func (a *auditWriter) readAudit(limit int) []AuditEntry {
	if limit <= 0 {
		limit = 200
	}
	f, err := os.Open(a.path)
	if err != nil {
		return []AuditEntry{}
	}
	defer func() { _ = f.Close() }()

	var entries []AuditEntry
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 512*1024)
	for scanner.Scan() {
		var e AuditEntry
		if json.Unmarshal(scanner.Bytes(), &e) == nil && e.Time != "" {
			entries = append(entries, e)
			if len(entries) > limit {
				entries = entries[1:]
			}
		}
	}
	// newest first
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}
	return entries
}

// sensitiveGetPaths are read endpoints whose access is audit-worthy even
// though they are GETs (credentials and configuration material).
var sensitiveGetPaths = map[string]bool{
	"/panel/api/v0/management/config.yaml":    true,
	"/panel/api/v8/management/config.yaml":    true,
	"/panel/api/v0/management/auth-files/download": true,
	"/panel/api/v0/management/logs":           true,
}

func shouldAudit(method, path string) bool {
	if method != http.MethodGet {
		return true
	}
	if sensitiveGetPaths[path] {
		return true
	}
	return strings.HasPrefix(path, "/panel/api/v0/management/request-error-logs/")
}

// recordAuthEvent writes an explicit authentication event (login/setup/logout
// success or failure) with a stable event tag.
func (h *Handler) recordAuthEvent(c *gin.Context, event string) {
	h.audit.write(AuditEntry{
		Time:   time.Now().UTC().Format(time.RFC3339),
		IP:     c.ClientIP(),
		Method: c.Request.Method,
		Path:   c.Request.URL.Path,
		Event:  event,
	})
}
