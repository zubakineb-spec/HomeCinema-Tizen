package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestTMDBProbeSuccess(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/configuration" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("unexpected auth header: %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"images":{}}`))
	}))
	defer ts.Close()

	tmdb := &TMDB{token: "test-token", client: ts.Client(), baseURL: ts.URL}
	if err := tmdb.Probe(); err != nil {
		t.Fatalf("Probe failed: %v", err)
	}
}

func TestTMDBProbeUnauthorizedIncludesMessage(t *testing.T) {
	var calls atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"status_code":7,"status_message":"Invalid API key"}`))
	}))
	defer ts.Close()

	tmdb := &TMDB{token: "bad-token", client: ts.Client(), baseURL: ts.URL, retryBase: time.Millisecond}
	err := tmdb.Probe()
	if err == nil || !strings.Contains(err.Error(), "401") || !strings.Contains(err.Error(), "Invalid API key") {
		t.Fatalf("unexpected error: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("401 must not retry; calls=%d", calls.Load())
	}
}

func TestTMDBProbeRequiresToken(t *testing.T) {
	tmdb := NewTMDB("")
	err := tmdb.Probe()
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTMDBRetriesTooManyRequests(t *testing.T) {
	var calls atomic.Int32
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if n == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"status_code":25,"status_message":"Your request count is over the allowed limit."}`))
			return
		}
		_, _ = w.Write([]byte(`{"images":{}}`))
	}))
	defer ts.Close()

	tmdb := &TMDB{token: "test-token", client: ts.Client(), baseURL: ts.URL, retryBase: time.Millisecond}
	if err := tmdb.Probe(); err != nil {
		t.Fatalf("Probe after 429 retry failed: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("expected 2 calls, got %d", calls.Load())
	}
}

func TestTMDBShowUsesRussianAliasFallback(t *testing.T) {
	var queries []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/search/tv":
			q := r.URL.Query().Get("query")
			queries = append(queries, q)
			if q == "Холод" {
				_, _ = w.Write([]byte(`{"results":[{"id":321}]}`))
				return
			}
			_, _ = w.Write([]byte(`{"results":[]}`))
		case "/tv/321":
			_, _ = w.Write([]byte(`{"id":321,"name":"Холод","original_name":"Холод"}`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer ts.Close()

	tmdb := &TMDB{token: "test-token", client: ts.Client(), baseURL: ts.URL, retryBase: time.Millisecond}
	d, err := tmdb.Show("Holod")
	if err != nil {
		t.Fatalf("Show failed: %v", err)
	}
	if d.ID != 321 || d.Name != "Холод" {
		t.Fatalf("unexpected details: %+v", d)
	}
	if len(queries) != 2 || queries[0] != "Holod" || queries[1] != "Холод" {
		t.Fatalf("unexpected queries: %#v", queries)
	}
}

func TestTMDBShowUsesNaLduAliasFallback(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/search/tv":
			if r.URL.Query().Get("query") == "На льду" {
				_, _ = w.Write([]byte(`{"results":[{"id":654}]}`))
				return
			}
			_, _ = w.Write([]byte(`{"results":[]}`))
		case "/tv/654":
			_, _ = w.Write([]byte(`{"id":654,"name":"На льду","original_name":"На льду"}`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer ts.Close()

	tmdb := &TMDB{token: "test-token", client: ts.Client(), baseURL: ts.URL, retryBase: time.Millisecond}
	d, err := tmdb.Show("Na ldu")
	if err != nil {
		t.Fatalf("Show failed: %v", err)
	}
	if d.ID != 654 || d.Name != "На льду" {
		t.Fatalf("unexpected details: %+v", d)
	}
}
