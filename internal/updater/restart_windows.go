//go:build windows

package updater

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func filepathAbs(p string) (string, error) { return filepath.Abs(p) }
func replaceAll(v, old, new string) string { return strings.ReplaceAll(v, old, new) }

// spawnSupervisor schedules a one-shot Windows task that waits for this
// process to exit and then starts the replacement binary. The task runs under
// the Task Scheduler service, which is deliberately used instead of a plain
// child process: services outside our process tree (and job objects created by
// shells or sandboxes with kill-on-close semantics) survive this process
// exiting, so the replacement reliably comes up.
func spawnSupervisor(plan *RestartPlan) error {
	scriptPath, taskName, script, err := renderSupervisorScript(plan)
	if err != nil {
		return err
	}
	if err := os.WriteFile(scriptPath, []byte(script), 0o600); err != nil {
		return fmt.Errorf("write restart script: %w", err)
	}
	action := fmt.Sprintf("powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File '%s'", scriptPath)
	create := exec.Command("schtasks", "/create", "/f", "/tn", taskName, "/sc", "once", "/st", "00:00", "/tr", action)
	if out, err := create.CombinedOutput(); err != nil {
		_ = os.Remove(scriptPath)
		return fmt.Errorf("register restart task: %v: %s", err, strings.TrimSpace(string(out)))
	}
	run := exec.Command("schtasks", "/run", "/tn", taskName)
	if out, err := run.CombinedOutput(); err != nil {
		_ = os.Remove(scriptPath)
		_ = exec.Command("schtasks", "/delete", "/f", "/tn", taskName).Run()
		return fmt.Errorf("run restart task: %v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// renderSupervisorScript builds the wait-then-start PowerShell script. Startup
// is retried to ride out port-release races right after the old process dies.
// The script removes both itself and its task registration when done.
func renderSupervisorScript(plan *RestartPlan) (string, string, string, error) {
	taskName := fmt.Sprintf("CLIProxyAPI-Restart-%d", plan.PID)
	scriptPath := filepath.Join(os.TempDir(), fmt.Sprintf("cliproxyapi-restart-%d.ps1", plan.PID))
	quoted := make([]string, 0, len(plan.Args))
	for _, a := range plan.Args {
		// Windows-style quoting so paths with spaces stay one argument; the
		// joined string is placed inside a single-quoted PowerShell literal,
		// where embedded double quotes are literal characters.
		quoted = append(quoted, `"`+strings.ReplaceAll(a, `"`, ``)+`"`)
	}
	script := strings.Join([]string{
		fmt.Sprintf("Wait-Process -Id %d -Timeout 60 -ErrorAction SilentlyContinue", plan.PID),
		"Start-Sleep -Milliseconds 800",
		fmt.Sprintf("for ($i = 0; $i -lt 5; $i++) { try { Start-Process -FilePath %s -WorkingDirectory %s -ArgumentList '%s' -WindowStyle Hidden -ErrorAction Stop; break } catch { $_.Exception.Message | Out-File -Append (Join-Path $env:TEMP 'cliproxyapi-restart-err.log'); Start-Sleep -Seconds 2 } }",
			psSingleQuote(plan.Executable),
			psSingleQuote(plan.WorkDir),
			strings.Join(quoted, " ")),
		fmt.Sprintf("Remove-Item -LiteralPath %s -ErrorAction SilentlyContinue", psSingleQuote(scriptPath)),
		fmt.Sprintf("schtasks /delete /f /tn '%s' 2>$null | Out-Null", taskName),
	}, "\n") + "\n"
	return scriptPath, taskName, script, nil
}
