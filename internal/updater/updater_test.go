package updater

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// fakeRelease serves a GitHub-style latest-release payload plus asset files so
// the full check → download → verify → extract → swap pipeline can run offline.
func fakeRelease(t *testing.T, version string, payload []byte) *httptest.Server {
	t.Helper()
	var assetName string
	if runtime.GOOS == "windows" {
		assetName = "CLIProxyAPI_" + version + "_windows_amd64.zip"
	} else {
		assetName = "CLIProxyAPI_" + version + "_linux_amd64.tar.gz"
	}
	sum := sha256.Sum256(payload)
	checksums := hex.EncodeToString(sum[:]) + "  " + assetName + "\n"

	mux := http.NewServeMux()
	mux.HandleFunc("/api/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tag_name":"v` + version + `","published_at":"2026-10-29T00:00:00Z","assets":[` +
			`{"name":"` + assetName + `","size":` + itoa(len(payload)) + `,"browser_download_url":"/download/` + assetName + `"},` +
			`{"name":"checksums.txt","size":0,"browser_download_url":"/download/checksums.txt"}]}`))
	})
	mux.HandleFunc("/download/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/download/checksums.txt" {
			_, _ = w.Write([]byte(checksums))
			return
		}
		_, _ = w.Write(payload)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

func buildFakeAsset(t *testing.T, dir, version string) []byte {
	t.Helper()
	binData := []byte("fake binary payload for " + version + " — padded to look like a real binary")
	binName := "CLIProxyAPI.exe"
	if runtime.GOOS != "windows" {
		binName = "CLIProxyAPI"
	}
	assetPath := filepath.Join(dir, "asset")
	if runtime.GOOS == "windows" {
		zf, err := os.Create(assetPath)
		if err != nil {
			t.Fatal(err)
		}
		zw := zip.NewWriter(zf)
		entry, err := zw.Create(binName)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(binData); err != nil {
			t.Fatal(err)
		}
		if err := zw.Close(); err != nil {
			t.Fatal(err)
		}
		_ = zf.Close()
	} else {
		// tar.gz
		f, err := os.Create(assetPath)
		if err != nil {
			t.Fatal(err)
		}
		gz := gzipWriter(f)
		tw := tarWriter(gz)
		hdr := tarHeader(binName, int64(len(binData)))
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := tw.Write(binData); err != nil {
			t.Fatal(err)
		}
		if err := tw.Close(); err != nil {
			t.Fatal(err)
		}
		if err := gz.Close(); err != nil {
			t.Fatal(err)
		}
		_ = f.Close()
	}
	data, err := os.ReadFile(assetPath)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestCheckAndApplyFullPipeline(t *testing.T) {
	tmp := t.TempDir()
	exe := filepath.Join(tmp, "CLIProxyAPI.exe")
	if runtime.GOOS != "windows" {
		exe = filepath.Join(tmp, "CLIProxyAPI")
	}
	if err := os.WriteFile(exe, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}

	payload := buildFakeAsset(t, tmp, "8.0.99")
	srv := fakeRelease(t, "8.0.99", payload)
	SetEndpoints(srv.URL+"/api/releases/latest", srv.URL+"/download")
	t.Cleanup(func() { SetEndpoints("https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest", "") })

	st, err := Check(context.Background(), "", "v8.0.47", "abc", "date")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !st.UpdateAvailable {
		t.Fatalf("expected update available, got %+v", st)
	}
	if st.AssetName == "" || st.ChecksumSHA256 == "" {
		t.Fatalf("expected asset and checksum, got %+v", st)
	}

	st.ExecutablePath = exe
	st.InDocker = false
	stages := make([]string, 0, 4)
	if err := Apply(context.Background(), "", st, func(s string) { stages = append(stages, s) }); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if len(stages) < 4 {
		t.Fatalf("expected all stages, got %v", stages)
	}

	// The running path now holds the extracted binary; the old one was moved aside.
	data, err := os.ReadFile(exe)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "fake binary payload for 8.0.99 — padded to look like a real binary" {
		t.Fatalf("binary not swapped, content: %q", string(data)[:min(len(data), 60)])
	}
	if _, err := os.Stat(exe + ".old"); err != nil {
		t.Fatalf("old binary not preserved: %v", err)
	}
	if _, err := os.Stat(exe + ".download"); !os.IsNotExist(err) {
		t.Fatalf("download artifact not cleaned up")
	}
}

func TestCheckChecksumMismatchFails(t *testing.T) {
	tmp := t.TempDir()
	exe := filepath.Join(tmp, "CLIProxyAPI.exe")
	if runtime.GOOS != "windows" {
		exe = filepath.Join(tmp, "CLIProxyAPI")
	}
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := buildFakeAsset(t, tmp, "8.0.99")
	srv := fakeRelease(t, "8.0.99", payload)
	// Corrupt the checksum so verification must fail.
	orig := srv.Config
	_ = orig
	SetEndpoints(srv.URL+"/api/releases/latest", srv.URL+"/download")
	t.Cleanup(func() { SetEndpoints("https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest", "") })
	// Serve wrong checksum by wrapping: easiest is to tamper with status checksum.
	st, err := Check(context.Background(), "", "dev", "", "")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	st.ChecksumSHA256 = "0000000000000000000000000000000000000000000000000000000000000000"
	st.ExecutablePath = exe
	st.InDocker = false
	if err := Apply(context.Background(), "", st, nil); err == nil {
		t.Fatal("expected checksum mismatch error")
	}
	// Original binary must be untouched.
	if data, _ := os.ReadFile(exe); string(data) != "old" {
		t.Fatal("binary changed despite failed apply")
	}
}

func TestApplyRejectsDocker(t *testing.T) {
	st := &Status{AssetURL: "http://x/y.zip", InDocker: true, ExecutablePath: "x"}
	if err := Apply(context.Background(), "", st, nil); err == nil {
		t.Fatal("expected docker rejection")
	}
}
