package app

import (
	"context"
	"encoding/pem"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"crypto/x509"
)

func TestRC330EmbeddedISRGRootsAreValidSelfSignedCAs(t *testing.T) {
	rest := []byte(tmdbImageExtraRootsPEM)
	count := 0
	for len(rest) > 0 {
		block, next := pem.Decode(rest)
		if block == nil {
			break
		}
		rest = next
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			t.Fatalf("parse embedded root: %v", err)
		}
		if !cert.IsCA {
			t.Fatalf("embedded certificate is not a CA: %s", cert.Subject)
		}
		if err := cert.CheckSignatureFrom(cert); err != nil {
			t.Fatalf("embedded root is not self-signed: %s: %v", cert.Subject, err)
		}
		count++
	}
	if count != 2 {
		t.Fatalf("expected 2 embedded ISRG roots, got %d", count)
	}
}

func TestRC330ImageDirectTransportUsesExtraRootsWithoutDisablingTLS(t *testing.T) {
	rt := newDirectHostTransport(tmdbImageHost, "143.244.60.196")
	tr, ok := rt.(*http.Transport)
	if !ok {
		t.Fatalf("unexpected transport type %T", rt)
	}
	if tr.TLSClientConfig == nil {
		t.Fatal("TLS config missing")
	}
	if tr.TLSClientConfig.InsecureSkipVerify {
		t.Fatal("RC3.30 must not disable TLS certificate verification")
	}
	if tr.TLSClientConfig.RootCAs == nil {
		t.Fatal("TMDB image transport must use augmented root pool")
	}
}

func TestRC330ImageHostBypassesPoisonedSystemDNSPrimary(t *testing.T) {
	var primaryCalls atomic.Int32
	var resolveCalls atomic.Int32
	var directCalls atomic.Int32

	tr := &tmdbFallbackTransport{
		primary: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			primaryCalls.Add(1)
			return &http.Response{
				StatusCode: http.StatusOK,
				Status:     "200 OK",
				Body:       io.NopCloser(strings.NewReader("wrong-local-qnap-response")),
				Header:     make(http.Header),
			}, nil
		}),
		resolver: resolverFunc(func(_ context.Context, host string) ([]string, error) {
			resolveCalls.Add(1)
			if host != tmdbImageHost {
				t.Fatalf("unexpected host %s", host)
			}
			return []string{"143.244.60.196"}, nil
		}),
		directFactory: func(host, ip string) http.RoundTripper {
			if host != tmdbImageHost || ip != "143.244.60.196" {
				t.Fatalf("unexpected direct target %s %s", host, ip)
			}
			return roundTripperFunc(func(r *http.Request) (*http.Response, error) {
				directCalls.Add(1)
				return &http.Response{
					StatusCode: http.StatusOK,
					Status:     "200 OK",
					Body:       io.NopCloser(strings.NewReader("jpeg")),
					Header:     http.Header{"Content-Type": []string{"image/jpeg"}},
					Request:    r,
				}, nil
			})
		},
	}

	req, err := http.NewRequest(http.MethodGet, "https://image.tmdb.org/t/p/w500/example.jpg", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := tr.RoundTrip(req)
	if err != nil {
		t.Fatalf("direct image path failed: %v", err)
	}
	resp.Body.Close()

	if primaryCalls.Load() != 0 {
		t.Fatalf("system-DNS primary transport was called %d times", primaryCalls.Load())
	}
	if resolveCalls.Load() != 1 || directCalls.Load() != 1 {
		t.Fatalf("resolve=%d direct=%d", resolveCalls.Load(), directCalls.Load())
	}
}
