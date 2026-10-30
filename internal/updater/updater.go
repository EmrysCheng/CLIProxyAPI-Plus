// Package updater implements in-panel self-update for the CLIProxyAPI binary:
// it inspects GitHub releases, downloads the platform asset, verifies its
// SHA256 checksum, extracts the binary, and swaps the running executable.
package updater

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Defaults overridable for testing.
var (
	releaseAPIURL = "https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest"
	downloadBase  = "" // empty = use browser_download_url from the API
)

// SetEndpoints overrides the release API URL and an optional fixed download
// base (used by tests to point at a local fake release server).
func SetEndpoints(apiURL, dlBase string) {
	releaseAPIURL = apiURL
	downloadBase = dlBase
}

// Status describes the update state surfaced to the panel.
type Status struct {
	CurrentVersion   string `json:"current_version"`
	CurrentCommit    string `json:"current_commit"`
	CurrentBuildDate string `json:"current_build_date"`
	LatestVersion    string `json:"latest_version"`
	LatestPublished  string `json:"latest_published_at"`
	UpdateAvailable  bool   `json:"update_available"`
	GOOS             string `json:"goos"`
	GOARCH           string `json:"goarch"`
	ExecutablePath   string `json:"executable_path"`
	InDocker         bool   `json:"in_docker"`
	AssetName        string `json:"asset_name,omitempty"`
	AssetSize        int64  `json:"asset_size,omitempty"`
	AssetURL         string `json:"asset_url,omitempty"`
	ChecksumSHA256   string `json:"checksum_sha256,omitempty"`
	Note             string `json:"note,omitempty"`
}

type releaseAsset struct {
	Name               string `json:"name"`
	Size               int64  `json:"size"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type releaseInfo struct {
	TagName    string         `json:"tag_name"`
	Published  string         `json:"published_at"`
	Prerelease bool           `json:"prerelease"`
	Assets     []releaseAsset `json:"assets"`
}

// assetMeta picks the release asset matching the running platform.
// Version tags look like v8.0.47 while asset names carry 8.0.47.
func assetMeta(rel *releaseInfo, goos, goarch string) *releaseAsset {
	version := strings.TrimPrefix(strings.TrimSpace(rel.TagName), "v")
	for _, want := range []string{
		fmt.Sprintf("CLIProxyAPI_%s_%s_%s", version, goos, goarch),
	} {
		for i := range rel.Assets {
			name := rel.Assets[i].Name
			if strings.HasPrefix(name, want+"_no-plugin") || strings.HasPrefix(name, want+".") {
				// Prefer the plugin-enabled build over the no-plugin variant.
				if strings.Contains(name, "_no-plugin") {
					continue
				}
				return &rel.Assets[i]
			}
		}
	}
	// Fall back to the no-plugin build when nothing else matches (e.g. freebsd/aarch64).
	for i := range rel.Assets {
		if strings.HasPrefix(rel.Assets[i].Name, fmt.Sprintf("CLIProxyAPI_%s_%s_%s_no-plugin", version, goos, goarch)) {
			return &rel.Assets[i]
		}
	}
	return nil
}

func httpClient() *http.Client { return &http.Client{Timeout: 30 * time.Second} }

// Check queries the latest GitHub release and compares it with the running
// build. token, when non-empty, is sent as a Bearer token to raise the GitHub
// API rate limit.
func Check(ctx context.Context, token, curVersion, curCommit, curBuildDate string) (*Status, error) {
	rel, err := fetchRelease(ctx, token)
	if err != nil {
		return nil, err
	}
	st := &Status{
		CurrentVersion:   curVersion,
		CurrentCommit:    curCommit,
		CurrentBuildDate: curBuildDate,
		LatestVersion:    strings.TrimSpace(rel.TagName),
		LatestPublished:  rel.Published,
		GOOS:             runtime.GOOS,
		GOARCH:           runtime.GOARCH,
		InDocker:         inDocker(),
	}
	if exe, err := os.Executable(); err == nil {
		if abs, errAbs := filepath.Abs(exe); errAbs == nil {
			st.ExecutablePath = abs
		}
	}
	running := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(curVersion)), "v")
	latest := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(rel.TagName)), "v")
	st.UpdateAvailable = latest != "" && running != "" && running != "dev" && latest != running
	// A dev/local build cannot be version-compared; offer the update anyway so
	// the operator can move to an official release.
	if running == "" || running == "dev" {
		st.UpdateAvailable = true
		st.Note = "dev build: update will replace it with the official release"
	}
	if asset := assetMeta(rel, runtime.GOOS, runtime.GOARCH); asset != nil {
		st.AssetName = asset.Name
		st.AssetSize = asset.Size
		st.AssetURL = asset.BrowserDownloadURL
		if downloadBase != "" {
			st.AssetURL = strings.TrimRight(downloadBase, "/") + "/" + asset.Name
		}
		sums, errSum := fetchChecksums(ctx, token, rel, asset.Name)
		if errSum == nil {
			st.ChecksumSHA256 = sums
		}
	} else {
		st.Note = "no prebuilt asset for this platform in the latest release"
	}
	return st, nil
}

func fetchRelease(ctx context.Context, token string) (*releaseInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, releaseAPIURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if token = strings.TrimSpace(token); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := httpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("query latest release: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("latest release: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var rel releaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode release: %w", err)
	}
	if rel.TagName == "" {
		return nil, errors.New("release payload has no tag name")
	}
	return &rel, nil
}

func fetchChecksums(ctx context.Context, token string, rel *releaseInfo, assetName string) (string, error) {
	var url string
	if downloadBase != "" {
		url = strings.TrimRight(downloadBase, "/") + "/checksums.txt"
	} else {
		for _, a := range rel.Assets {
			if a.Name == "checksums.txt" {
				url = a.BrowserDownloadURL
				break
			}
		}
		if url == "" {
			return "", errors.New("checksums.txt not published")
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	if token = strings.TrimSpace(token); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("checksums: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 2 && strings.EqualFold(fields[1], assetName) {
			return strings.ToLower(fields[0]), nil
		}
	}
	return "", errors.New("asset not listed in checksums.txt")
}

// Apply downloads the platform asset, verifies its checksum, extracts the
// binary and swaps the running executable. progress, when non-nil, receives
// human-readable stage updates. The caller is expected to restart afterwards.
func Apply(ctx context.Context, token string, st *Status, progress func(stage string)) error {
	if st == nil || st.AssetURL == "" {
		return errors.New("no downloadable asset for this platform")
	}
	exePath := st.ExecutablePath
	if exePath == "" {
		exe, err := os.Executable()
		if err != nil {
			return fmt.Errorf("resolve executable: %w", err)
		}
		exePath, _ = filepath.Abs(exe)
	}
	if st.InDocker {
		return errors.New("running inside Docker: update the container image instead of the binary")
	}

	if progress != nil {
		progress("downloading")
	}
	assetFile := exePath + ".download"
	if err := download(ctx, token, st.AssetURL, assetFile, st.AssetSize); err != nil {
		return err
	}
	defer func() { _ = os.Remove(assetFile) }()

	if progress != nil {
		progress("verifying")
	}
	if st.ChecksumSHA256 != "" {
		sum, err := fileSHA256(assetFile)
		if err != nil {
			return fmt.Errorf("hash asset: %w", err)
		}
		if !strings.EqualFold(sum, st.ChecksumSHA256) {
			return fmt.Errorf("checksum mismatch: got %s want %s", sum, st.ChecksumSHA256)
		}
	}

	if progress != nil {
		progress("extracting")
	}
	newExe := exePath + ".new"
	_ = os.Remove(newExe)
	if err := extractBinary(assetFile, st.AssetName, newExe); err != nil {
		return err
	}

	if progress != nil {
		progress("swapping")
	}
	oldExe := exePath + ".old"
	_ = os.Remove(oldExe)
	if err := os.Rename(exePath, oldExe); err != nil {
		return fmt.Errorf("move running binary: %w", err)
	}
	if err := os.Rename(newExe, exePath); err != nil {
		// Best effort rollback keeps the service runnable.
		_ = os.Rename(oldExe, exePath)
		return fmt.Errorf("place new binary: %w", err)
	}
	if progress != nil {
		progress("done")
	}
	return nil
}

func download(ctx context.Context, token, url, dest string, expected int64) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	if token = strings.TrimSpace(token); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 15 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("download asset: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("download asset: HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("stage asset: %w", err)
	}
	written, errCopy := io.Copy(out, resp.Body)
	if errClose := out.Close(); err == nil {
		err = errClose
	}
	if errCopy != nil {
		return fmt.Errorf("download asset: %w", errCopy)
	}
	if expected > 0 && written != expected {
		return fmt.Errorf("download incomplete: got %d bytes, want %d", written, expected)
	}
	if written == 0 {
		return errors.New("downloaded asset is empty")
	}
	return err
}

func fileSHA256(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// extractBinary pulls the server binary out of a zip (windows) or tar.gz
// (unix) asset. Inside the official archives the binary sits at the root.
func extractBinary(assetPath, assetName, dest string) error {
	binName := strings.TrimSuffix(assetName, filepath.Ext(assetName))
	switch {
	case strings.EqualFold(filepath.Ext(assetName), ".zip"):
		return extractFromZip(assetPath, binName, dest)
	case strings.HasSuffix(assetName, ".tar.gz"), strings.HasSuffix(assetName, ".tgz"):
		return extractFromTarGz(assetPath, binName, dest)
	default:
		// Unknown container: treat the asset itself as the raw binary.
		return copyFile(assetPath, dest)
	}
}

func extractFromZip(assetPath, binName, dest string) error {
	r, err := zip.OpenReader(assetPath)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer func() { _ = r.Close() }()

	// Prefer an exact/loose name match, otherwise the largest regular file.
	var best *zip.File
	var bestSize uint64
	for i := range r.File {
		f := r.File[i]
		if f.FileInfo().IsDir() {
			continue
		}
		base := filepath.Base(f.Name)
		if strings.EqualFold(strings.TrimSuffix(base, filepath.Ext(base)), binName) {
			best = f
			break
		}
		if f.UncompressedSize64 > bestSize {
			best = f
			bestSize = f.UncompressedSize64
		}
	}
	if best == nil {
		return errors.New("binary not found inside zip asset")
	}
	src, err := best.Open()
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, src); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func extractFromTarGz(assetPath, binName, dest string) error {
	f, err := os.Open(assetPath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("open gzip: %w", err)
	}
	defer func() { _ = gz.Close() }()
	tr := tar.NewReader(gz)
	var bestName string
	var bestSize int64
	var bestData []byte
	for {
		hdr, err := tr.Next()
		if err != nil {
			break
		}
		if hdr.Typeflag != tar.TypeReg {
			continue
		}
		base := filepath.Base(hdr.Name)
		if strings.EqualFold(strings.TrimSuffix(base, filepath.Ext(base)), binName) {
			data, errRead := io.ReadAll(tr)
			if errRead != nil {
				return errRead
			}
			bestName, bestData, bestSize = hdr.Name, data, hdr.Size
			break
		}
		if hdr.Size > bestSize {
			data, errRead := io.ReadAll(io.LimitReader(tr, 1<<30))
			if errRead != nil {
				return errRead
			}
			bestName, bestData, bestSize = hdr.Name, data, hdr.Size
		}
	}
	if bestData == nil {
		return errors.New("binary not found inside tar.gz asset")
	}
	_ = bestName
	return os.WriteFile(dest, bestData, 0o755)
}

func copyFile(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}

func inDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}
