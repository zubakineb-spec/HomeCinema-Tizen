package app

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRC332PersistsImageTransportFailure(t *testing.T) {
	dir := t.TempDir()
	s := &Server{cfg: Config{DataDir: dir}}
	u, err := url.Parse("https://image.tmdb.org/t/p/w500/example.jpg")
	if err != nil {
		t.Fatal(err)
	}

	s.recordTMDBImageTransportFailure(u, errors.New("context deadline exceeded"))

	data, err := os.ReadFile(filepath.Join(dir, rc332ImageTransportLog))
	if err != nil {
		t.Fatalf("read diagnostic log: %v", err)
	}
	text := string(data)
	for _, marker := range []string{
		"host=image.tmdb.org",
		"path=/t/p/w500/example.jpg",
		"context deadline exceeded",
	} {
		if !strings.Contains(text, marker) {
			t.Fatalf("missing %q in diagnostic log: %q", marker, text)
		}
	}
}
