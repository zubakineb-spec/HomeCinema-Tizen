package app

import (
	"context"
	"net/http"
	"testing"
)

func TestRC332ImageResolverPrefersKnownSeedBeforeDoH(t *testing.T) {
	r := &dohResolver{
		providers: []dohProvider{
			{name: "must-not-run", host: "invalid.example", bootstrap: []string{"203.0.113.1"}, path: "/dns-query"},
		},
		imageSeeds: []string{"127.0.0.1", "143.244.60.196", "192.168.0.101"},
	}

	ips, err := r.ResolveA(context.Background(), tmdbImageHost)
	if err != nil {
		t.Fatalf("image resolution failed: %v", err)
	}
	if len(ips) != 1 || ips[0] != "143.244.60.196" {
		t.Fatalf("expected known-good image seed first, got %#v", ips)
	}
}

func TestRC332ImageRoundTripUsesSeedWithoutPrimaryOrDoH(t *testing.T) {
	r := &dohResolver{imageSeeds: []string{"143.244.60.196"}}
	primaryCalled := false
	directCalled := false

	tr := &tmdbFallbackTransport{
		primary: roundTripperFunc(func(*http.Request) (*http.Response, error) {
			primaryCalled = true
			t.Fatal("system-DNS primary transport must not run for image.tmdb.org")
			return nil, nil
		}),
		resolver: r,
		directFactory: func(host, ip string) http.RoundTripper {
			directCalled = true
			if host != tmdbImageHost || ip != "143.244.60.196" {
				t.Fatalf("unexpected direct target %s %s", host, ip)
			}
			return roundTripperFunc(func(req *http.Request) (*http.Response, error) {
				return &http.Response{
					StatusCode: 200,
					Status:     "200 OK",
					Header:     make(http.Header),
					Body:       http.NoBody,
					Request:    req,
				}, nil
			})
		},
	}

	req, err := http.NewRequest(http.MethodGet, "https://image.tmdb.org/t/p/w500/test.jpg", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := tr.RoundTrip(req)
	if err != nil {
		t.Fatalf("seed-first round trip failed: %v", err)
	}
	resp.Body.Close()

	if primaryCalled {
		t.Fatal("primary transport was unexpectedly called")
	}
	if !directCalled {
		t.Fatal("known-good direct seed was not used")
	}
}
