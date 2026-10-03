package main

import (
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	pass := "admin"
	if len(os.Args) > 1 {
		pass = os.Args[1]
	}
	path := "/var/lib/lxddash/admin.json"
	if len(os.Args) > 2 {
		path = os.Args[2]
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(pass), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	json := fmt.Sprintf(`{"username":"admin","password_hash":"%s"}`, string(hash))
	if err := os.WriteFile(path, []byte(json), 0o600); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("admin.json written to", path)
	fmt.Println("Password:", pass)
}
