package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
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
	if !strings.EqualFold(u.Hostname(), "image.tmdb.org") {
		return nil, fmt.Errorf("unsupported image host")
	}
	return u, nil
}

func imageCachePath(dir, raw string, u *url.URL) string {
	sum := sha256.Sum256([]byte(raw))
	return filepath.Join(dir, hex.EncodeToString(sum[:])+cacheImageExtension(u))
}

func serveCachedImage(w http.ResponseWriter, r *http.Request, path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	if ct := mime.TypeByExtension(filepath.Ext(path)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.Header().Set("X-HomeCinema-Image-Cache", "HIT")
	http.ServeFile(w, r, path)
	return true
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

	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", "HomeCinema/0.3.18 QNAP-D1")
	resp, err := client.Do(req)
	if err != nil {
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
	if err = writeAtomicBytes(path, data); err != nil {
		jsonErr(w, http.StatusInternalServerError, "image cache write failed")
		return
	}
	if resp.Header.Get("Content-Type") != "" {
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
	}
	w.Header().Set("Cache-Control", "public, max-age=2592000, immutable")
	w.Header().Set("X-HomeCinema-Image-Cache", "MISS")
	_, _ = w.Write(data)
}
