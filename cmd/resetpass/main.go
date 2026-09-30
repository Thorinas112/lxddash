package main

import (
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	hash, err := bcrypt.GenerateFromPassword([]byte("admin"), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	json := fmt.Sprintf(`{"username":"admin","password_hash":"%s"}`, string(hash))
	if err := os.WriteFile(`\\wsl.localhost\Ubuntu\var\lib\lxddash\admin.json`, []byte(json), 0600); err != nil {
		fmt.Fprintf(os.Stderr, "write error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("admin.json written successfully")
	fmt.Println("Password: admin")
}
