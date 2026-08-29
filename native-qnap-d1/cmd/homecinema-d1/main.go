package main

import (
	"fmt"
	"log"
	"os"

	"homecinema-d1/internal/app"
)

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-v") {
		fmt.Println(app.Version)
		return
	}

	cfg := app.LoadConfig()
	if len(os.Args) > 1 && os.Args[1] == "--tmdb-test" {
		tmdb := app.NewTMDB(cfg.TMDBToken)
		if err := tmdb.Probe(); err != nil {
			fmt.Printf("TMDB_ERROR=%v\n", err)
			os.Exit(3)
		}
		fmt.Println("TMDB_OK")
		return
	}

	srv, err := app.NewServer(cfg)
	if err != nil {
		log.Fatal(err)
	}
	app.StartAutoLibrarySync(srv, cfg)
	log.Printf("Home Cinema D1 %s listening on %s; media=%s; auto_scan=%ds", app.Version, cfg.Listen, cfg.MediaRoot, cfg.AutoScanSeconds)
	if err := srv.ListenAndServe(); err != nil {
		log.Printf("server stopped: %v", err)
		os.Exit(1)
	}
}
