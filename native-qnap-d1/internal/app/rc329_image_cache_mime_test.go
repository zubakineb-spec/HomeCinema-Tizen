package app

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRC329CachedJPGNameWithWebPBytesUsesWebPMIME(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "poster.jpg")
	// HTTP content sniffing recognizes RIFF....WEBP as image/webp even when the
	// source URL/file name ends in .jpg.
	data := []byte{'R', 'I', 'F', 'F', 0x10, 0x00, 0x00, 0x00, 'W', 'E', 'B', 'P', 'V', 'P', '8', ' '}
	data = append(data, make([]byte, 32)...)
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	if got := sniffImageContentType(path); got != "image/webp" {
		t.Fatalf("sniffImageContentType=%q want image/webp", got)
	}

	req := httptest.NewRequest("GET", "http://homecinema.local/api/image", nil)
	rr := httptest.NewRecorder()
	if !serveCachedImage(rr, req, path) {
		t.Fatal("cached image was not served")
	}
	if got := rr.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("Content-Type=%q want image/webp", got)
	}
	if got := rr.Header().Get("X-HomeCinema-Image-Cache"); got != "HIT" {
		t.Fatalf("cache header=%q", got)
	}
}
