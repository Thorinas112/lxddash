package updates

import (
	"context"
	"os"
	"os/exec"
	"strings"
)

// Package is a single upgradable package.
type Package struct {
	Name    string `json:"name"`
	Current string `json:"current"`
	New     string `json:"new"`
	Arch    string `json:"arch"`
}

// Status describes the host's update state.
type Status struct {
	Available bool      `json:"available"` // apt/dnf present?
	Manager   string    `json:"manager"`   // "apt" | "dnf" | ""
	Count     int       `json:"count"`
	Packages  []Package `json:"packages"`
	Security  int       `json:"security"`
	LastCheck string    `json:"last_check,omitempty"`
}

// Service checks for and applies OS package updates.
type Service struct{}

func New() *Service { return &Service{} }

// Check returns the list of upgradable packages.
func (s *Service) Check(ctx context.Context) (Status, error) {
	st := Status{Packages: []Package{}}
	if _, err := exec.LookPath("apt"); err == nil {
		st.Manager = "apt"
	} else if _, err := exec.LookPath("dnf"); err == nil {
		st.Manager = "dnf"
	} else {
		return st, nil
	}

	// Refresh package lists (best-effort, may need network).
	_, _ = runPriv(ctx, st.Manager, "update")

	var out string
	var err error
	if st.Manager == "apt" {
		out, err = run(ctx, "apt", "list", "--upgradable")
	} else {
		out, err = run(ctx, "dnf", "list", "upgrades")
	}
	if err != nil {
		return st, err
	}

	for _, ln := range strings.Split(strings.TrimSpace(out), "\n") {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "Listing") || strings.HasPrefix(ln, "Upgradable") ||
			strings.HasPrefix(ln, "WARNING:") || strings.HasPrefix(ln, "Hint:") {
			continue
		}
		if st.Manager == "apt" {
			// Format: pkg/arch current new size
			fields := strings.Fields(ln)
			if len(fields) < 3 {
				continue
			}
			nameArch := strings.SplitN(fields[0], "/", 2)
			pkg := Package{Name: nameArch[0], Current: fields[1], New: fields[2]}
			if len(nameArch) > 1 {
				pkg.Arch = nameArch[1]
			}
			st.Packages = append(st.Packages, pkg)
		} else {
			// dnf format: pkg.arch current repo new
			fields := strings.Fields(ln)
			if len(fields) < 4 {
				continue
			}
			nameArch := strings.SplitN(fields[0], ".", 2)
			pkg := Package{Name: nameArch[0], Current: fields[1], New: fields[3]}
			if len(nameArch) > 1 {
				pkg.Arch = nameArch[1]
			}
			st.Packages = append(st.Packages, pkg)
		}
	}
	st.Count = len(st.Packages)
	st.Available = true
	return st, nil
}

// Upgrade applies all pending upgrades. Returns the command output.
// Package lists are refreshed first (apt update) so the upgrade
// doesn't fail with exit status 100 on stale lists. When the server
// is not running as root, commands are prefixed with `sudo -n`
// (non-interactive — fails fast instead of hanging on a password
// prompt).
func (s *Service) Upgrade(ctx context.Context) (string, error) {
	if _, err := exec.LookPath("apt"); err == nil {
		// Refresh package lists first; a failure here is not fatal
		// (offline hosts can still upgrade from cached lists).
		updateOut, _ := runPriv(ctx, "apt", "update")
		out, err := runPriv(ctx, "apt", "upgrade", "-y")
		return updateOut + out, err
	}
	if _, err := exec.LookPath("dnf"); err == nil {
		_, _ = runPriv(ctx, "dnf", "check-update")
		return runPriv(ctx, "dnf", "upgrade", "-y")
	}
	return "", nil
}

// run executes a package-manager command without elevation.
func run(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// runPriv executes a command that needs root, elevating with `sudo -n`
// when the process is not root. Non-interactive sudo fails fast with a
// clear message instead of hanging on a password prompt.
func runPriv(ctx context.Context, name string, args ...string) (string, error) {
	if os.Geteuid() == 0 {
		return run(ctx, name, args...)
	}
	cmdArgs := append([]string{"-n", name}, args...)
	cmd := exec.CommandContext(ctx, "sudo", cmdArgs...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}