package webui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAuditWriteAndRead(t *testing.T) {
	dir := t.TempDir()
	a := newAuditWriter(filepath.Join(dir, "config.yaml"))

	a.write(AuditEntry{Time: "2026-01-01T00:00:01Z", IP: "127.0.0.1", Method: "POST", Path: "/panel/api/auth/login", Status: 200, Event: "login_ok"})
	a.write(AuditEntry{Time: "2026-01-01T00:00:02Z", IP: "127.0.0.1", Method: "PUT", Path: "/panel/api/v0/management/debug", Status: 200})
	a.write(AuditEntry{Time: "2026-01-01T00:00:03Z", IP: "127.0.0.1", Method: "DELETE", Path: "/panel/api/v0/management/auth-files", Status: 200})

	entries := a.readAudit(10)
	if len(entries) != 3 {
		t.Fatalf("entries = %d, want 3", len(entries))
	}
	// Newest first.
	if entries[0].Path != "/panel/api/v0/management/auth-files" {
		t.Fatalf("newest first violated: %s", entries[0].Path)
	}
	if entries[2].Event != "login_ok" {
		t.Fatalf("event missing: %+v", entries[2])
	}
}

func TestAuditReadLimit(t *testing.T) {
	dir := t.TempDir()
	a := newAuditWriter(filepath.Join(dir, "config.yaml"))
	for i := 0; i < 10; i++ {
		a.write(AuditEntry{Time: "2026-01-01T00:00:00Z", IP: "127.0.0.1", Method: "POST", Path: "/p", Status: 200})
	}
	entries := a.readAudit(3)
	if len(entries) != 3 {
		t.Fatalf("entries = %d, want 3", len(entries))
	}
}

func TestAuditRotation(t *testing.T) {
	dir := t.TempDir()
	a := newAuditWriter(filepath.Join(dir, "config.yaml"))
	// Shrink the threshold for the test.
	defer func(prev int64) { auditFileMaxBytes = prev }(auditFileMaxBytes)
	auditFileMaxBytes = 64

	big := strings.Repeat("x", 80)
	a.write(AuditEntry{Time: "2026-01-01T00:00:00Z", IP: "127.0.0.1", Method: "POST", Path: big, Status: 200})
	a.write(AuditEntry{Time: "2026-01-01T00:00:01Z", IP: "127.0.0.1", Method: "POST", Path: big, Status: 200})

	if _, err := os.Stat(a.path + ".1"); err != nil {
		t.Fatalf("rotated file missing: %v", err)
	}
	entries := a.readAudit(10)
	if len(entries) != 1 {
		t.Fatalf("entries after rotation = %d, want 1 (current file only)", len(entries))
	}
}

func TestShouldAudit(t *testing.T) {
	cases := []struct {
		method, path string
		want         bool
	}{
		{"PUT", "/panel/api/v0/management/debug", true},
		{"DELETE", "/panel/api/v0/management/auth-files", true},
		{"POST", "/panel/api/v0/management/api-call", true},
		{"GET", "/panel/api/v0/management/auth-files", false},
		{"GET", "/panel/api/v0/management/config.yaml", true},
		{"GET", "/panel/api/v0/management/request-error-logs/abc.log", true},
		{"GET", "/panel/api/v0/management/routing/strategy", false},
	}
	for _, tc := range cases {
		if got := shouldAudit(tc.method, tc.path); got != tc.want {
			t.Fatalf("shouldAudit(%s, %s) = %v, want %v", tc.method, tc.path, got, tc.want)
		}
	}
}

