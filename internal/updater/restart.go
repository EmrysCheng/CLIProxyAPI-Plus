package updater

import (
	"fmt"
	"os"
)

// RestartPlan captures how the current process was started so a detached
// supervisor can bring the replacement process up after the old one exits.
type RestartPlan struct {
	Executable string
	Args       []string
	WorkDir    string
	PID        int
}

// Plan snapshots the running process for Restart.
func Plan() (*RestartPlan, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("resolve executable: %w", err)
	}
	abs, err := filepathAbs(exe)
	if err != nil {
		return nil, err
	}
	wd, err := os.Getwd()
	if err != nil {
		wd = ""
	}
	return &RestartPlan{
		Executable: abs,
		Args:       append([]string(nil), os.Args[1:]...),
		WorkDir:    wd,
		PID:        os.Getpid(),
	}, nil
}

// Restart spawns a detached supervisor that waits for the current process to
// exit and then starts the replacement with the original arguments. The caller
// should flush its HTTP response, shut down and exit shortly after.
func Restart(plan *RestartPlan) error {
	if plan == nil {
		return fmt.Errorf("no restart plan")
	}
	return spawnSupervisor(plan)
}

func psSingleQuote(v string) string {
	return "'" + replaceAll(v, "'", "''") + "'"
}
