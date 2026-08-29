package app

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

func TestRC328ImageCacheUsesTMDBFallbackClientAndCachesResult(t *testing.T) {
	var calls atomic.Int32
	client := &http.Client{Transport: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.Hostname() != tmdbImageHost {
			t.Fatalf("unexpected image host: %s", r.URL.Hostname())
		}
		return &http.Response{
			StatusCode:    http.StatusOK,
			Status:        "200 OK",
			Body:          io.NopCloser(strings.NewReader("fake-jpeg-bytes")),
			Header:        http.Header{"Content-Type": []string{"image/jpeg"}},
			ContentLength: int64(len("fake-jpeg-bytes")),
			Request:       r,
		}, nil
	})}

	tmdb := NewTMDB("token")
	tmdb.client = client
	s := &Server{
		cfg:  Config{ImageCacheDir: t.TempDir()},
		tmdb: tmdb,
	}

	raw := "https://image.tmdb.org/t/p/w500/example.jpg"
	requestURL := "/api/image?url=" + url.QueryEscape(raw)

	firstReq := httptest.NewRequest(http.MethodGet, requestURL, nil)
	firstRec := httptest.NewRecorder()
	s.imageCache(firstRec, firstReq)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first image request status=%d body=%s", firstRec.Code, firstRec.Body.String())
	}
	if firstRec.Header().Get("X-HomeCinema-Image-Cache") != "MISS" {
		t.Fatalf("first request cache=%q", firstRec.Header().Get("X-HomeCinema-Image-Cache"))
	}
	if firstRec.Body.String() != "fake-jpeg-bytes" {
		t.Fatalf("unexpected image body %q", firstRec.Body.String())
	}
	if calls.Load() != 1 {
		t.Fatalf("fallback client calls=%d", calls.Load())
	}

	secondReq := httptest.NewRequest(http.MethodGet, requestURL, nil)
	secondRec := httptest.NewRecorder()
	s.imageCache(secondRec, secondReq)
	if secondRec.Code != http.StatusOK {
		t.Fatalf("cached image request status=%d body=%s", secondRec.Code, secondRec.Body.String())
	}
	if secondRec.Header().Get("X-HomeCinema-Image-Cache") != "HIT" {
		t.Fatalf("second request cache=%q", secondRec.Header().Get("X-HomeCinema-Image-Cache"))
	}
	if calls.Load() != 1 {
		t.Fatalf("cached request unexpectedly hit upstream; calls=%d", calls.Load())
	}
}

func TestRC328ValidateImageHostUsesSharedTMDBImageConstant(t *testing.T) {
	if _, err := validateTMDBImageURL("https://" + tmdbImageHost + "/t/p/w500/a.jpg"); err != nil {
		t.Fatalf("TMDB image host rejected: %v", err)
	}
	if _, err := validateTMDBImageURL("https://example.com/a.jpg"); err == nil {
		t.Fatal("non-TMDB image host must be rejected")
	}
}
