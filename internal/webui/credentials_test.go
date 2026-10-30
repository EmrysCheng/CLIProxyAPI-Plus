package webui

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCredentialStoreSetupOnce(t *testing.T) {
	dir := t.TempDir()
	store := newCredentialStore(filepath.Join(dir, "config.yaml"))

	if !store.SetupRequired() {
		t.Fatal("fresh store must require setup")
	}
	if err := store.Setup("super-secret-1"); err != nil {
		t.Fatalf("setup: %v", err)
	}
	if store.SetupRequired() {
		t.Fatal("setup required after Setup")
	}
	// Second setup must be refused.
	if err := store.Setup("another-password"); err == nil {
		t.Fatal("second setup must fail")
	}
	if !store.Verify("super-secret-1") {
		t.Fatal("verify original password")
	}
	if store.Verify("wrong") {
		t.Fatal("wrong password must not verify")
	}
}

func TestCredentialStorePersistence(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	store := newCredentialStore(path)
	if err := store.Setup("persist-me-123"); err != nil {
		t.Fatalf("setup: %v", err)
	}

	// A fresh store over the same directory loads the persisted hash.
	reloaded := newCredentialStore(path)
	reloaded.load()
	if reloaded.SetupRequired() {
		t.Fatal("persisted credentials not found")
	}
	if !reloaded.Verify("persist-me-123") {
		t.Fatal("persisted password does not verify")
	}
	if reloaded.Verify("other") {
		t.Fatal("wrong password verifies after reload")
	}

	// The on-disk file must never contain the plaintext password.
	raw, err := os.ReadFile(filepath.Join(dir, PanelAuthFileName))
	if err != nil {
		t.Fatalf("read credential file: %v", err)
	}
	if len(raw) == 0 || filepath.Join(dir, PanelAuthFileName) == "" {
		t.Fatal("credential file missing")
	}
	if containsBytes(raw, []byte("persist-me-123")) {
		t.Fatal("plaintext password leaked to disk")
	}
}

func TestCredentialStoreUpdate(t *testing.T) {
	dir := t.TempDir()
	store := newCredentialStore(filepath.Join(dir, "config.yaml"))

	// Update before setup must fail.
	if err := store.Update("old", "new-password-1"); err == nil {
		t.Fatal("update before setup must fail")
	}
	if err := store.Setup("old-password"); err != nil {
		t.Fatalf("setup: %v", err)
	}
	// Wrong old password must fail.
	if err := store.Update("wrong-old", "new-password-1"); err == nil {
		t.Fatal("update with wrong old password must fail")
	}
	if !store.Verify("old-password") {
		t.Fatal("password must be unchanged after failed update")
	}
	if err := store.Update("old-password", "new-password-1"); err != nil {
		t.Fatalf("update: %v", err)
	}
	if store.Verify("old-password") {
		t.Fatal("old password still verifies after update")
	}
	if !store.Verify("new-password-1") {
		t.Fatal("new password does not verify")
	}
}

func TestCredentialStoreRejectsCorruptFile(t *testing.T) {
	dir := t.TempDir()
	authFile := filepath.Join(dir, PanelAuthFileName)
	if err := os.WriteFile(authFile, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := newCredentialStore(filepath.Join(dir, "config.yaml"))
	if !store.SetupRequired() {
		t.Fatal("corrupt credential file must be treated as setup required")
	}
	if store.Verify("anything") {
		t.Fatal("corrupt store must not verify anything")
	}
	// And setup must succeed over the corrupt file.
	if err := store.Setup("recovered-pass"); err != nil {
		t.Fatalf("setup over corrupt file: %v", err)
	}
	if !store.Verify("recovered-pass") {
		t.Fatal("password does not verify after recovery")
	}
}

func containsBytes(haystack, needle []byte) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := range needle {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
