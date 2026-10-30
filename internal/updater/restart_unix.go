//go:build !windows

package updater

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

func filepathAbs(p string) (string, error) { return filepath.Abs(p) }
func replaceAll(v, old, new string) string { return strings.ReplaceAll(v, old, new) }

// spawnSupervisor shells out to sh: wait for this process to exit, then
// nohup-start the replacement. The shell detaches via setsid when available so
// it survives service managers that kill the process group.
func spawnSupervisor(plan *RestartPlan) error {
	quoted := make([]string, 0, len(plan.Args))
	for _, a := range plan.Args {
		quoted = append(quoted, shQuote(a))
	}
	script := fmt.Sprintf(
		"while kill -0 %d 2>/dev/null; do sleep 0.3; done; cd '%s' && (setsid nohup '%s' %s >/dev/null 2>&1 & || nohup '%s' %s >/dev/null 2>&1 &)",
		plan.PID,
		shQuote(plan.WorkDir),
		shQuote(plan.Executable),
		strings.Join(quoted, " "),
		shQuote(plan.Executable),
		strings.Join(quoted, " "),
	)
	cmd := exec.Command("sh", "-c", script)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("spawn restart supervisor: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	return nil
}

func shQuote(v string) string {
	return "'" + strings.ReplaceAll(v, "'", `'\''`) + "'"
}
