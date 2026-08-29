package app

import (
	"log"
	"net/http"
	"sync"
	"time"
)

var libraryScanMu sync.Mutex

// scanLibraryOnce reconciles persisted catalog.json with the real media tree.
// ScanLocalIncremental reuses unchanged media profiles, so the periodic pass is
// cheap for an unchanged QNAP library while still detecting additions/removals.
func scanLibraryOnce(s *Server) (ScanStats, error) {
	libraryScanMu.Lock()
	defer libraryScanMu.Unlock()

	m, sh, ep, stats, err := ScanLocalIncremental(s.cfg, s.store.Snapshot())
	if err != nil {
		return stats, err
	}
	if err = s.store.ReplaceScan(m, sh, ep); err != nil {
		return stats, err
	}
	if s.tmdb.enabled() {
		s.enrich()
	}
	return stats, nil
}

// StartAutoLibrarySync is deliberately started only by the production main
// process. Unit tests that construct Server directly do not get background
// goroutines. Set HC_AUTO_SCAN_SECONDS=0 to disable it for diagnostics.
func StartAutoLibrarySync(srv *http.Server, cfg Config) {
	if srv == nil || cfg.AutoScanSeconds <= 0 {
		return
	}
	s, ok := srv.Handler.(*Server)
	if !ok || s == nil {
		return
	}
	interval := time.Duration(cfg.AutoScanSeconds) * time.Second
	go func() {
		// Let QNAP mounts/listener settle after boot, then reconcile immediately.
		time.Sleep(3 * time.Second)
		for {
			stats, err := scanLibraryOnce(s)
			if err != nil {
				log.Printf("library auto-scan failed: %v", err)
			} else if stats.Profiled > 0 || stats.Removed > 0 {
				log.Printf("library auto-scan updated: files=%d reused=%d profiled=%d removed=%d", stats.Files, stats.Reused, stats.Profiled, stats.Removed)
			}
			time.Sleep(interval)
		}
	}()
}
