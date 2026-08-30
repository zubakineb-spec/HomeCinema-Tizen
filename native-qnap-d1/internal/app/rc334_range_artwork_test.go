package app

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestRC334RangeClientUsesShortPerChunkTimeoutWithoutMutatingMetadata(t *testing.T) {
	base := &http.Client{Transport: http.DefaultTransport, Timeout: 20 * time.Second}
	s := &Server{tmdb: &TMDB{client: base}}

	client := s.tmdbImageRangeHTTPClient()
	if client == base {
		t.Fatal("range image client must be a copy")
	}
	if base.Timeout != 20*time.Second {
		t.Fatalf("metadata timeout changed: %v", base.Timeout)
	}
	if client.Timeout != tmdbImageRangeRequestTimeout {
		t.Fatalf("range timeout=%v want=%v", client.Timeout, tmdbImageRangeRequestTimeout)
	}
	if client.Transport != base.Transport {
		t.Fatal("range client must preserve verified TMDB transport")
	}
}

func TestRC334ParsesContentRange(t *testing.T) {
	start, end, total, err := parseTMDBContentRange("bytes 8192-16383/74275")
	if err != nil {
		t.Fatal(err)
	}
	if start != 8192 || end != 16383 || total != 74275 {
		t.Fatalf("unexpected range %d-%d/%d", start, end, total)
	}
}

func TestRC334AssemblesImageFromIndependent8KRangeRequests(t *testing.T) {
	payload := make([]byte, 74275)
	for i := range payload {
		payload[i] = byte(i % 251)
	}
	payload[0] = 0xff
	payload[1] = 0xd8

	var ranges []string
	rt := rc333RoundTripperFunc(func(r *http.Request) (*http.Response, error) {
		if !r.Close {
			t.Fatal("range request must force connection close")
		}
		if got := r.Header.Get("Accept-Encoding"); got != "identity" {
			t.Fatalf("Accept-Encoding=%q", got)
		}
		rangeHeader := r.Header.Get("Range")
		ranges = append(ranges, rangeHeader)
		if !strings.HasPrefix(rangeHeader, "bytes=") {
			return nil, fmt.Errorf("missing range")
		}
		parts := strings.Split(strings.TrimPrefix(rangeHeader, "bytes="), "-")
		if len(parts) != 2 {
			return nil, fmt.Errorf("bad range %q", rangeHeader)
		}
		start, err := strconv.Atoi(parts[0])
		if err != nil {
			return nil, err
		}
		end, err := strconv.Atoi(parts[1])
		if err != nil {
			return nil, err
		}
		if start < 0 || start >= len(payload) {
			return nil, fmt.Errorf("start out of range: %d", start)
		}
		if end >= len(payload) {
			end = len(payload) - 1
		}
		chunk := append([]byte(nil), payload[start:end+1]...)
		return &http.Response{
			StatusCode: http.StatusPartialContent,
			Status:     "206 Partial Content",
			Header: http.Header{
				"Content-Type":  []string{"image/jpeg"},
				"Content-Range": []string{fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload))},
			},
			Body:          io.NopCloser(bytes.NewReader(chunk)),
			ContentLength: int64(len(chunk)),
			Request:       r,
		}, nil
	})

	dataDir := t.TempDir()
	s := &Server{
		cfg: Config{DataDir: dataDir, ImageCacheDir: filepath.Join(dataDir, "image-cache")},
		tmdb: &TMDB{client: &http.Client{Transport: rt, Timeout: 20 * time.Second}},
	}

	source := "https://image.tmdb.org/t/p/w500/example.jpg"
	req := httptest.NewRequest(http.MethodGet, "/api/image?url="+url.QueryEscape(source), nil)
	w := httptest.NewRecorder()
	s.imageCache(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if !bytes.Equal(w.Body.Bytes(), payload) {
		t.Fatalf("assembled payload differs: got=%d want=%d", w.Body.Len(), len(payload))
	}
	if got := w.Header().Get("X-HomeCinema-Image-Cache"); got != "MISS" {
		t.Fatalf("cache header=%q want MISS", got)
	}

	wantRanges := []string{
		"bytes=0-8191",
		"bytes=8192-16383",
		"bytes=16384-24575",
		"bytes=24576-32767",
		"bytes=32768-40959",
		"bytes=40960-49151",
		"bytes=49152-57343",
		"bytes=57344-65535",
		"bytes=65536-73727",
		"bytes=73728-74274",
	}
	if len(ranges) != len(wantRanges) {
		t.Fatalf("range requests=%d want=%d: %v", len(ranges), len(wantRanges), ranges)
	}
	for i := range wantRanges {
		if ranges[i] != wantRanges[i] {
			t.Fatalf("range[%d]=%q want=%q", i, ranges[i], wantRanges[i])
		}
	}

	// A second request must use the assembled on-disk cache and make no new CDN calls.
	before := len(ranges)
	w2 := httptest.NewRecorder()
	s.imageCache(w2, req)
	if w2.Code != http.StatusOK {
		t.Fatalf("cache status=%d", w2.Code)
	}
	if got := w2.Header().Get("X-HomeCinema-Image-Cache"); got != "HIT" {
		t.Fatalf("cache header=%q want HIT", got)
	}
	if len(ranges) != before {
		t.Fatalf("cache hit performed extra range requests: before=%d after=%d", before, len(ranges))
	}
}

func TestRC334RangeFailurePersistsExactChunkDiagnostic(t *testing.T) {
	dataDir := t.TempDir()
	imageDir := filepath.Join(dataDir, "image-cache")

	rt := rc333RoundTripperFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusPartialContent,
			Status:     "206 Partial Content",
			Header: http.Header{
				"Content-Type":  []string{"image/jpeg"},
				"Content-Range": []string{"bytes 1-8191/74275"},
			},
			Body:          io.NopCloser(bytes.NewReader(make([]byte, 8191))),
			ContentLength: 8191,
			Request:       r,
		}, nil
	})

	s := &Server{
		cfg:  Config{DataDir: dataDir, ImageCacheDir: imageDir},
		tmdb: &TMDB{client: &http.Client{Transport: rt, Timeout: 20 * time.Second}},
	}

	source := "https://image.tmdb.org/t/p/w500/example.jpg"
	req := httptest.NewRequest(http.MethodGet, "/api/image?url="+url.QueryEscape(source), nil)
	w := httptest.NewRecorder()
	s.imageCache(w, req)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "TMDB image read failed") {
		t.Fatalf("unexpected response body: %s", w.Body.String())
	}

	data, err := os.ReadFile(filepath.Join(dataDir, rc332ImageTransportLog))
	if err != nil {
		t.Fatalf("read diagnostic: %v", err)
	}
	text := string(data)
	for _, want := range []string{
		"TMDB image range download failed",
		"TMDB range start=1 want=0",
		"host=image.tmdb.org",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("diagnostic missing %q: %s", want, text)
		}
	}
}
