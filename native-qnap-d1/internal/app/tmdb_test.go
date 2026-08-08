package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"status_code":7,"status_message":"Invalid API key"}`))
	}))
	defer ts.Close()

	tmdb := &TMDB{token: "bad-token", client: ts.Client(), baseURL: ts.URL}
	err := tmdb.Probe()
	if err == nil || !strings.Contains(err.Error(), "401") || !strings.Contains(err.Error(), "Invalid API key") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTMDBProbeRequiresToken(t *testing.T) {
	tmdb := NewTMDB("")
	err := tmdb.Probe()
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}
