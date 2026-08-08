package app

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

type resolverFunc func(context.Context, string) ([]string, error)

func (f resolverFunc) ResolveA(ctx context.Context, host string) ([]string, error) {
	return f(ctx, host)
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestTMDBFallbackActivatesAfterPrimaryNetworkError(t *testing.T) {
	primary := roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("x509: certificate has expired")
	})
	var resolved atomic.Int32
	resolver := resolverFunc(func(_ context.Context, host string) ([]string, error) {
		resolved.Add(1)
		if host != tmdbAPIHost {
			t.Fatalf("unexpected host: %s", host)
		}
		return []string{"3.170.19.94"}, nil
	})
	var direct atomic.Int32
	tr := &tmdbFallbackTransport{
		primary:  primary,
		resolver: resolver,
		directFactory: func(host, ip string) http.RoundTripper {
			if host != tmdbAPIHost || ip != "3.170.19.94" {
				t.Fatalf("unexpected direct target %s %s", host, ip)
			}
			return roundTripperFunc(func(r *http.Request) (*http.Response, error) {
				direct.Add(1)
				if r.URL.Hostname() != tmdbAPIHost {
					t.Fatalf("hostname changed: %s", r.URL.Hostname())
				}
				return &http.Response{StatusCode: 200, Status: "200 OK", Body: io.NopCloser(strings.NewReader(`{"images":{}}`)), Header: make(http.Header), Request: r}, nil
			})
		},
	}
	req, _ := http.NewRequest(http.MethodGet, "https://api.themoviedb.org/3/configuration", nil)
	resp, err := tr.RoundTrip(req)
	if err != nil {
		t.Fatalf("fallback failed: %v", err)
	}
	resp.Body.Close()
	if resolved.Load() != 1 || direct.Load() != 1 {
		t.Fatalf("resolver=%d direct=%d", resolved.Load(), direct.Load())
	}
}

func TestTMDBFallbackDoesNotReplaceHTTPResponse(t *testing.T) {
	var resolved atomic.Int32
	tr := &tmdbFallbackTransport{
		primary: roundTripperFunc(func(r *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 401, Status: "401 Unauthorized", Body: io.NopCloser(strings.NewReader(`{}`)), Header: make(http.Header), Request: r}, nil
		}),
		resolver: resolverFunc(func(context.Context, string) ([]string, error) { resolved.Add(1); return []string{"3.170.19.94"}, nil }),
	}
	req, _ := http.NewRequest(http.MethodGet, "https://api.themoviedb.org/3/configuration", nil)
	resp, err := tr.RoundTrip(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	if resolved.Load() != 0 {
		t.Fatal("fallback must not run for a valid HTTP response")
	}
}

func TestTMDBFallbackOnlyHandlesTMDBAPIHost(t *testing.T) {
	var resolved atomic.Int32
	tr := &tmdbFallbackTransport{
		primary:  roundTripperFunc(func(*http.Request) (*http.Response, error) { return nil, errors.New("network error") }),
		resolver: resolverFunc(func(context.Context, string) ([]string, error) { resolved.Add(1); return nil, nil }),
	}
	req, _ := http.NewRequest(http.MethodGet, "https://example.com/", nil)
	_, err := tr.RoundTrip(req)
	if err == nil {
		t.Fatal("expected primary error")
	}
	if resolved.Load() != 0 {
		t.Fatal("fallback activated for non-TMDB host")
	}
}

func TestIsPublicIPv4(t *testing.T) {
	good := []string{"3.170.19.94", "54.230.253.60", "8.8.8.8"}
	bad := []string{"127.0.0.1", "10.0.0.1", "172.18.0.2", "192.168.0.101", "169.254.1.2", "100.64.0.1", "224.0.0.1", "::1"}
	for _, s := range good {
		if !isPublicIPv4(net.ParseIP(s)) {
			t.Errorf("expected public: %s", s)
		}
	}
	for _, s := range bad {
		if isPublicIPv4(net.ParseIP(s)) {
			t.Errorf("expected rejected: %s", s)
		}
	}
}

func TestDirectTransportKeepsCertificateVerificationEnabled(t *testing.T) {
	rt := newDirectHostTransport(tmdbAPIHost, "3.170.19.94")
	tr, ok := rt.(*http.Transport)
	if !ok {
		t.Fatalf("unexpected transport type %T", rt)
	}
	if tr.TLSClientConfig == nil {
		t.Fatal("TLS config missing")
	}
	if tr.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("TLS verification must never be disabled")
	}
}

func TestDoHResolverFallsBackToPublicSeeds(t *testing.T) {
	r := &dohResolver{seeds: []string{"127.0.0.1", "3.170.19.94", "192.168.0.101"}}
	ips, err := r.ResolveA(context.Background(), tmdbAPIHost)
	if err != nil {
		t.Fatalf("seed fallback failed: %v", err)
	}
	if len(ips) != 1 || ips[0] != "3.170.19.94" {
		t.Fatalf("unexpected seeds: %#v", ips)
	}
}
