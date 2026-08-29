package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const maxCachedImageBytes = 20 << 20

func cacheImageExtension(u *url.URL) string {
	ext := strings.ToLower(filepath.Ext(u.Path))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".webp":
		return ext
	default:
		return ".img"
	}
}

func validateTMDBImageURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" {
		return nil, fmt.Errorf("invalid image URL")
	}
	if !strings.EqualFold(u.Hostname(), tmdbImageHost) {
		return nil, fmt.Errorf("unsupported image host")
	}
	return u, nil
}

func imageCachePath(dir, raw string, u *url.URL) string {
	sum := sha256.Sum256([]byte(raw))
	return filepath.Join(dir, hex.EncodeToString(sum[:])+cacheImageExtension(u))
}

func sniffImageContentType(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, 512)
	n, err := f.Read(buf)
	if err != nil && err != io.EOF {
		return ""
	}
	if n <= 0 {
		return ""
	}
	ct := http.DetectContentType(buf[:n])
	if strings.HasPrefix(strings.ToLower(ct), "image/") {
		return ct
	}
	return ""
}

func serveCachedImage(w http.ResponseWriter, r *http.Request, path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	// RC3.29: TMDB/BunnyCDN can return WebP bytes for a URL ending in .jpg.
	// Always prefer the real file signature over the cached filename extension.
	if ct := sniffImageContentType(path); ct != "" {
		w.Header().Set("Content-Type", ct)
	} else if ct := mime.TypeByExtension(filepath.Ext(path)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.Header().Set("X-HomeCinema-Image-Cache", "HIT")
	http.ServeFile(w, r, path)
	return true
}

// RC3.28: artwork downloads must use the same TMDB client as metadata calls.
// QNAP D1 installations can have broken/filtered system DNS while the explicit
// DoH/direct-host fallback still works. A plain http.Client here bypassed that
// fallback and caused catalog items to have valid poster URLs but blank artwork.
func (s *Server) tmdbImageHTTPClient() *http.Client {
	if s != nil && s.tmdb != nil && s.tmdb.client != nil {
		return s.tmdb.client
	}
	return newTMDBHTTPClient()
}

func (s *Server) imageCache(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonErr(w, http.StatusMethodNotAllowed, "GET required")
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("url"))
	u, err := validateTMDBImageURL(raw)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if err = os.MkdirAll(s.cfg.ImageCacheDir, 0755); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	path := imageCachePath(s.cfg.ImageCacheDir, raw, u)
	if serveCachedImage(w, r, path) {
		return
	}

	client := s.tmdbImageHTTPClient()
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", "HomeCinema/0.3.18 QNAP-D1")
	resp, err := client.Do(req)
	if err != nil {
		// RC3.31: keep the HTTP surface stable but retain the complete transport
		// error in the NAS log. This makes DNS, x509 and direct-fallback failures
		// distinguishable without exposing internals to the TV client.
		log.Printf("TMDB image fetch failed host=%s path=%s: %v", u.Hostname(), u.EscapedPath(), err)
		jsonErr(w, http.StatusBadGateway, "TMDB image unavailable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		jsonErr(w, http.StatusBadGateway, "TMDB image HTTP "+resp.Status)
		return
	}
	if resp.ContentLength > maxCachedImageBytes {
		jsonErr(w, http.StatusBadGateway, "TMDB image too large")
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxCachedImageBytes+1))
	if err != nil || len(data) > maxCachedImageBytes {
		jsonErr(w, http.StatusBadGateway, "TMDB image read failed")
		return
	}
	if len(data) == 0 {
		jsonErr(w, http.StatusBadGateway, "TMDB image empty")
		return
	}

	contentType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		contentType = http.DetectContentType(data)
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		jsonErr(w, http.StatusBadGateway, "TMDB response is not an image")
		return
	}

	if err = writeAtomicBytes(path, data); err != nil {
		jsonErr(w, http.StatusInternalServerError, "image cache write failed")
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.Header().Set("X-HomeCinema-Image-Cache", "MISS")
	_, _ = w.Write(data)
}
