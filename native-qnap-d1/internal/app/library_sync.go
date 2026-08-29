package app

import (
	"fmt"
	"hash/fnv"
	"log"
	"sort"
	"sync"
	"time"
)

// LibrarySyncState tracks the last fully completed media-library scan. The
// revision changes only after ReplaceScan and TMDB enrichment both finish, so
// TV clients never reload against a half-enriched catalog.
type LibrarySyncState struct {
	mu           sync.RWMutex
	scanMu       sync.Mutex
	revision     string
	lastScanAt   string
	lastScanErr  string
	lastScanStat ScanStats
}

func libraryRevision(st State) string {
	h := fnv.New64a()
	parts := make([]string, 0, len(st.Movies)+len(st.Episodes))
	for _, m := range st.Movies {
		parts = append(parts, fmt.Sprintf("m|%s|%d|%d", m.SourceURL, m.FileSize, m.FileMTime))
	}
	for _, e := range st.Episodes {
		parts = append(parts, fmt.Sprintf("e|%s|%d|%d", e.SourceURL, e.FileSize, e.FileMTime))
	}
	sort.Strings(parts)
	for _, p := range parts {
		_, _ = h.Write([]byte(p))
		_, _ = h.Write([]byte{0})
	}
	return fmt.Sprintf("%016x", h.Sum64())
}

func (s *Server) setLibrarySyncResult(stats ScanStats, err error) {
	if s.librarySync == nil {
		return
	}
	s.librarySync.mu.Lock()
	defer s.librarySync.mu.Unlock()
	s.librarySync.lastScanAt = time.Now().UTC().Format(time.RFC3339)
	s.librarySync.lastScanStat = stats
	if err != nil {
		s.librarySync.lastScanErr = err.Error()
		return
	}
	s.librarySync.lastScanErr = ""
	s.librarySync.revision = libraryRevision(s.store.Snapshot())
}

func (s *Server) librarySyncSnapshot() (revision, lastScanAt, lastScanErr string, stats ScanStats) {
	if s.librarySync == nil {
		return libraryRevision(s.store.Snapshot()), "", "", ScanStats{}
	}
	s.librarySync.mu.RLock()
	defer s.librarySync.mu.RUnlock()
	return s.librarySync.revision, s.librarySync.lastScanAt, s.librarySync.lastScanErr, s.librarySync.lastScanStat
}

func (s *Server) scanLibrary() (ScanStats, map[string]int, error) {
	if s.librarySync == nil {
		s.librarySync = &LibrarySyncState{}
	}
	s.librarySync.scanMu.Lock()
	defer s.librarySync.scanMu.Unlock()

	m, sh, ep, stats, err := ScanLocalIncremental(s.cfg, s.store.Snapshot())
	if err != nil {
		s.setLibrarySyncResult(stats, err)
		return stats, nil, err
	}
	if err = s.store.ReplaceScan(m, sh, ep); err != nil {
		s.setLibrarySyncResult(stats, err)
		return stats, nil, err
	}
	matched := map[string]int{"movies_matched": 0, "shows_matched": 0, "episodes_matched": 0}
	if s.tmdb.enabled() {
		matched = s.enrich()
	}
	s.setLibrarySyncResult(stats, nil)
	return stats, matched, nil
}

func (s *Server) startAutoLibrarySync() {
	if s.cfg.AutoScanSeconds <= 0 {
		return
	}
	interval := time.Duration(s.cfg.AutoScanSeconds) * time.Second
	go func() {
		// Give QNAP shares and the HTTP listener a short window to settle after
		// boot, then reconcile persisted catalog.json with the real filesystem.
		time.Sleep(3 * time.Second)
		for {
			stats, _, err := s.scanLibrary()
			if err != nil {
				log.Printf("library auto-scan failed: %v", err)
			} else if stats.Profiled > 0 || stats.Removed > 0 {
				log.Printf("library auto-scan updated: files=%d reused=%d profiled=%d removed=%d", stats.Files, stats.Reused, stats.Profiled, stats.Removed)
			}
			time.Sleep(interval)
		}
	}()
}
