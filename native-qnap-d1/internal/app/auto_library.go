package app

import (
	"hash/fnv"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type libraryFingerprint struct {
	Count int
	Bytes int64
	Hash  uint64
}

func isVideoExt(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mkv", ".mp4", ".m4v", ".avi", ".mov", ".ts", ".m2ts", ".webm":
		return true
	default:
		return false
	}
}

func fingerprintLibrary(root string) (libraryFingerprint, error) {
	h := fnv.New64a()
	fp := libraryFingerprint{}
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil { return nil }
		if info.IsDir() {
			if path != root && skipQNAPDir(info.Name()) { return filepath.SkipDir }
			return nil
		}
		if !isVideoExt(info.Name()) { return nil }
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil { return nil }
		fp.Count++
		fp.Bytes += info.Size()
		_, _ = h.Write([]byte(filepath.ToSlash(rel)))
		_, _ = h.Write([]byte{0})
		_, _ = h.Write([]byte(string(rune(info.Size() & 0xffff))))
		_, _ = h.Write([]byte{0})
		_, _ = h.Write([]byte(info.ModTime().UTC().Format(time.RFC3339Nano)))
		return nil
	})
	fp.Hash = h.Sum64()
	return fp, err
}

func (s *Server) startAutoLibrary() {
	if !s.cfg.AutoLibrary || s.cfg.AutoLibraryInterval <= 0 { return }
	baseline, err := fingerprintLibrary(s.cfg.MediaRoot)
	if err != nil {
		log.Printf("auto library disabled for current cycle: %v", err)
		return
	}
	interval := s.cfg.AutoLibraryInterval
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		candidate := libraryFingerprint{}
		hasCandidate := false
		for range ticker.C {
			current, err := fingerprintLibrary(s.cfg.MediaRoot)
			if err != nil {
				log.Printf("auto library fingerprint failed: %v", err)
				continue
			}
			if current == baseline {
				hasCandidate = false
				continue
			}
			if !hasCandidate || current != candidate {
				candidate = current
				hasCandidate = true
				log.Printf("auto library change detected; waiting one interval for file stability")
				continue
			}
			result, err := s.scanLibrary()
			if err != nil {
				log.Printf("auto library scan failed: %v", err)
				continue
			}
			baseline = current
			hasCandidate = false
			log.Printf("auto library scan complete: video_files=%v movies=%v shows=%v episodes=%v extras=%v", result["video_files"], result["movies"], result["shows"], result["episodes"], result["extras"])
		}
	}()
}
