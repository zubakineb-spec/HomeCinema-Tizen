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
	"time"
)

const (
	maxCachedImageBytes          = 20 << 20
	tmdbImageRequestTimeout      = 60 * time.Second
	tmdbImageRangeChunkBytes     = int64(8 << 10)
	tmdbImageRangeRequestTimeout = 20 * time.Second
)

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

// RC3.28: artwork downloads must use the same verified TMDB transport as
// metadata calls so QNAP DNS/TLS fallbacks stay active. RC3.33 kept that
// transport with a longer whole-request budget. RC3.34 adds a dedicated range
// client: physical QNAP diagnostics proved the CDN stalls a continuous body
// after one 16 KiB TLS application record, while independent 8 KiB HTTP Range
// requests all complete. Each range request still uses the verified TMDB
// transport, seed-first routing, SNI and certificate validation.
func (s *Server) tmdbImageHTTPClient() *http.Client {
	if s != nil && s.tmdb != nil && s.tmdb.client != nil {
		clone := *s.tmdb.client
		clone.Timeout = tmdbImageRequestTimeout
		return &clone
	}
	client := newTMDBHTTPClient()
	client.Timeout = tmdbImageRequestTimeout
	return client
}

func (s *Server) tmdbImageRangeHTTPClient() *http.Client {
	if s != nil && s.tmdb != nil && s.tmdb.client != nil {
		clone := *s.tmdb.client
		clone.Timeout = tmdbImageRangeRequestTimeout
		return &clone
	}
	client := newTMDBHTTPClient()
	client.Timeout = tmdbImageRangeRequestTimeout
	return client
}

func parseTMDBContentRange(value string) (start, end, total int64, err error) {
	value = strings.TrimSpace(value)
	if _, err = fmt.Sscanf(value, "bytes %d-%d/%d", &start, &end, &total); err != nil {
		return 0, 0, 0, fmt.Errorf("invalid TMDB Content-Range %q: %w", value, err)
	}
	if start < 0 || end < start || total <= 0 || end >= total {
		return 0, 0, 0, fmt.Errorf("invalid TMDB Content-Range bounds %q", value)
	}
	return start, end, total, nil
}

func newTMDBImageRangeRequest(u *url.URL, start, end int64) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "HomeCinema/0.3.18 QNAP-D1")
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	// The physical QNAP workaround depends on a fresh TLS stream per chunk.
	// The direct fallback transport already disables keep-alives; Close also
	// preserves that contract for injected/test transports and future changes.
	req.Close = true
	return req, nil
}

func readTMDBFullImageResponse(resp *http.Response) ([]byte, string, error) {
	if resp == nil {
		return nil, "", fmt.Errorf("nil TMDB image response")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("TMDB image HTTP %s", resp.Status)
	}
	if resp.ContentLength > maxCachedImageBytes {
		return nil, "", fmt.Errorf("TMDB image too large: %d", resp.ContentLength)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxCachedImageBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("TMDB image body read failed after %d bytes (content_length=%d): %w", len(data), resp.ContentLength, err)
	}
	if len(data) > maxCachedImageBytes {
		return nil, "", fmt.Errorf("TMDB image too large after read: %d", len(data))
	}
	if len(data) == 0 {
		return nil, "", fmt.Errorf("TMDB image empty")
	}
	return data, strings.TrimSpace(resp.Header.Get("Content-Type")), nil
}

func readTMDBRangeResponse(resp *http.Response, expectedStart, requestedEnd int64) ([]byte, int64, int64, int64, string, error) {
	if resp == nil {
		return nil, 0, 0, 0, "", fmt.Errorf("nil TMDB range response")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		return nil, 0, 0, 0, "", fmt.Errorf("TMDB range HTTP %s", resp.Status)
	}
	start, end, total, err := parseTMDBContentRange(resp.Header.Get("Content-Range"))
	if err != nil {
		return nil, 0, 0, 0, "", err
	}
	if start != expectedStart {
		return nil, 0, 0, 0, "", fmt.Errorf("TMDB range start=%d want=%d", start, expectedStart)
	}
	if end > requestedEnd {
		return nil, 0, 0, 0, "", fmt.Errorf("TMDB range end=%d exceeds requested=%d", end, requestedEnd)
	}
	if total > maxCachedImageBytes {
		return nil, 0, 0, 0, "", fmt.Errorf("TMDB image too large: %d", total)
	}
	expectedBytes := end - start + 1
	data, err := io.ReadAll(io.LimitReader(resp.Body, expectedBytes+1))
	if err != nil {
		return nil, 0, 0, 0, "", fmt.Errorf("TMDB range %d-%d body read failed after %d bytes: %w", start, end, len(data), err)
	}
	if int64(len(data)) != expectedBytes {
		return nil, 0, 0, 0, "", fmt.Errorf("TMDB range %d-%d bytes=%d want=%d", start, end, len(data), expectedBytes)
	}
	return data, start, end, total, strings.TrimSpace(resp.Header.Get("Content-Type")), nil
}

func (s *Server) downloadTMDBImageByRange(u *url.URL) ([]byte, string, error) {
	client := s.tmdbImageRangeHTTPClient()
	firstEnd := tmdbImageRangeChunkBytes - 1
	firstReq, err := newTMDBImageRangeRequest(u, 0, firstEnd)
	if err != nil {
		return nil, "", err
	}
	firstResp, err := client.Do(firstReq)
	if err != nil {
		return nil, "", fmt.Errorf("TMDB first range request failed: %w", err)
	}

	// Standards-compliant servers may ignore Range and return a complete 200.
	// Keep the RC3.33 full-body path as a compatibility fallback. BunnyCDN on the
	// target QNAP returns 206, so production hardware takes the range path below.
	if firstResp.StatusCode == http.StatusOK {
		return readTMDBFullImageResponse(firstResp)
	}

	firstData, _, firstGotEnd, total, contentType, err := readTMDBRangeResponse(firstResp, 0, firstEnd)
	if err != nil {
		return nil, "", err
	}
	assembled := make([]byte, 0, int(total))
	assembled = append(assembled, firstData...)

	for start := firstGotEnd + 1; start < total; {
		end := start + tmdbImageRangeChunkBytes - 1
		if end >= total {
			end = total - 1
		}
		req, reqErr := newTMDBImageRangeRequest(u, start, end)
		if reqErr != nil {
			return nil, "", reqErr
		}
		resp, doErr := client.Do(req)
		if doErr != nil {
			return nil, "", fmt.Errorf("TMDB range %d-%d request failed: %w", start, end, doErr)
		}
		chunk, gotStart, gotEnd, gotTotal, _, readErr := readTMDBRangeResponse(resp, start, end)
		if readErr != nil {
			return nil, "", readErr
		}
		if gotTotal != total {
			return nil, "", fmt.Errorf("TMDB range total changed: %d -> %d", total, gotTotal)
		}
		if gotStart != start || gotEnd < gotStart {
			return nil, "", fmt.Errorf("TMDB range made no progress: got=%d-%d want_start=%d", gotStart, gotEnd, start)
		}
		assembled = append(assembled, chunk...)
		start = gotEnd + 1
	}

	if int64(len(assembled)) != total {
		return nil, "", fmt.Errorf("TMDB assembled image bytes=%d want=%d", len(assembled), total)
	}
	return assembled, contentType, nil
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

	data, contentType, err := s.downloadTMDBImageByRange(u)
	if err != nil {
		// RC3.34: persist the exact failed chunk/range while keeping the public API
		// response stable for the TV client.
		rangeErr := fmt.Errorf("TMDB image range download failed: %w", err)
		log.Printf("%v", rangeErr)
		s.recordTMDBImageTransportFailure(u, rangeErr)
		jsonErr(w, http.StatusBadGateway, "TMDB image read failed")
		return
	}

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
