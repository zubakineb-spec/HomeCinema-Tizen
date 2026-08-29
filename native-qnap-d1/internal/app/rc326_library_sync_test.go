package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRC326AutoReconcileAddsAndRemovesMovies(t *testing.T) {
	root := t.TempDir()
	data := t.TempDir()
	oldPath := filepath.Join(root, "Old.Movie.2020.mkv")
	if err := os.WriteFile(oldPath, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}

	store, err := NewStore(data)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{
		cfg: Config{
			MediaRoot:    root,
			MediaBaseURL: "http://192.168.0.101:8096/media/",
			DataDir:      data,
		},
		store: store,
		tmdb:  NewTMDB(""),
	}

	first, err := scanLibraryOnce(s)
	if err != nil {
		t.Fatal(err)
	}
	if first.Files != 1 || len(store.Snapshot().Movies) != 1 {
		t.Fatalf("initial reconcile: stats=%+v movies=%d", first, len(store.Snapshot().Movies))
	}

	if err := os.Remove(oldPath); err != nil {
		t.Fatal(err)
	}
	newPath := filepath.Join(root, "New.Movie.2026.mkv")
	if err := os.WriteFile(newPath, []byte("new movie"), 0644); err != nil {
		t.Fatal(err)
	}

	second, err := scanLibraryOnce(s)
	if err != nil {
		t.Fatal(err)
	}
	st := store.Snapshot()
	if second.Removed != 1 {
		t.Fatalf("removed=%d want 1; stats=%+v", second.Removed, second)
	}
	if len(st.Movies) != 1 {
		t.Fatalf("movies=%d want 1", len(st.Movies))
	}
	if !strings.Contains(st.Movies[0].SourceURL, "New.Movie.2026.mkv") {
		t.Fatalf("stale catalog after reconcile: %+v", st.Movies)
	}
	if strings.Contains(st.Movies[0].SourceURL, "Old.Movie.2020.mkv") {
		t.Fatalf("deleted movie survived reconcile: %+v", st.Movies)
	}
}

func TestRC326AutoReconcileRemovesDeletedEpisode(t *testing.T) {
	root := t.TempDir()
	data := t.TempDir()
	dir := filepath.Join(root, "Series", "Test Show", "Season 01")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	e1 := filepath.Join(dir, "01.mkv")
	e2 := filepath.Join(dir, "02.mkv")
	if err := os.WriteFile(e1, []byte("1"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(e2, []byte("2"), 0644); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(data)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{cfg: Config{MediaRoot: root, MediaBaseURL: "http://192.168.0.101:8096/media/", DataDir: data}, store: store, tmdb: NewTMDB("")}
	if _, err = scanLibraryOnce(s); err != nil {
		t.Fatal(err)
	}
	if got := len(store.Snapshot().Episodes); got != 2 {
		t.Fatalf("episodes=%d want 2", got)
	}
	if err := os.Remove(e2); err != nil {
		t.Fatal(err)
	}
	stats, err := scanLibraryOnce(s)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Removed != 1 || len(store.Snapshot().Episodes) != 1 {
		t.Fatalf("stats=%+v episodes=%d", stats, len(store.Snapshot().Episodes))
	}
}
