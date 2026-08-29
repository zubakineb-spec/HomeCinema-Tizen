package app

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	tmdbAPIHost   = "api.themoviedb.org"
	tmdbImageHost = "image.tmdb.org"
)

type ipv4Resolver interface {
	ResolveA(context.Context, string) ([]string, error)
}

type dohProvider struct {
	name      string
	host      string
	bootstrap []string
	path      string
}

type dohResolver struct {
	providers []dohProvider
	// API and image CDN use independent networks. Never reuse one host's seed
	// addresses for the other host.
	apiSeeds   []string
	imageSeeds []string
	timeout    time.Duration
}

type tmdbFallbackTransport struct {
	primary       http.RoundTripper
	resolver      ipv4Resolver
	directFactory func(string, string) http.RoundTripper
}

func isTMDBFallbackHost(host string) bool {
	return strings.EqualFold(host, tmdbAPIHost) || strings.EqualFold(host, tmdbImageHost)
}

func newTMDBHTTPClient() *http.Client {
	d := &net.Dialer{Timeout: 4 * time.Second, KeepAlive: 30 * time.Second}
	primary := &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         d.DialContext,
		ForceAttemptHTTP2:   false,
		MaxIdleConns:        8,
		MaxIdleConnsPerHost: 4,
		IdleConnTimeout:     30 * time.Second,
		TLSHandshakeTimeout: 5 * time.Second,
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
	}
	return &http.Client{
		Transport: &tmdbFallbackTransport{
			primary:       primary,
			resolver:      newDoHResolver(),
			directFactory: newDirectHostTransport,
		},
		Timeout: 20 * time.Second,
	}
}

func newDoHResolver() *dohResolver {
	return &dohResolver{
		timeout: 3 * time.Second,
		providers: []dohProvider{
			{name: "cloudflare", host: "cloudflare-dns.com", bootstrap: []string{"1.1.1.1", "1.0.0.1"}, path: "/dns-query"},
			{name: "google", host: "dns.google", bootstrap: []string{"8.8.8.8", "8.8.4.4"}, path: "/resolve"},
		},
		apiSeeds: []string{
			"3.170.19.94", "3.170.19.97", "3.170.19.104", "3.170.19.106",
			"54.230.253.60", "54.230.253.66", "54.230.253.88", "54.230.253.112",
		},
		// RC3.29/RC3.30: image.tmdb.org is served by BunnyCDN. The seed is an
		// emergency path when DoH is unavailable on the old QNAP. RC3.30 also
		// supplies current ISRG roots for this direct TLS connection.
		imageSeeds: []string{"143.244.60.196"},
	}
}

func (r *dohResolver) seedIPsForHost(host string) []string {
	if r == nil {
		return nil
	}
	if strings.EqualFold(host, tmdbAPIHost) {
		return publicIPv4List(r.apiSeeds)
	}
	if strings.EqualFold(host, tmdbImageHost) {
		return publicIPv4List(r.imageSeeds)
	}
	return nil
}

func (r *dohResolver) ResolveA(ctx context.Context, host string) ([]string, error) {
	if r == nil {
		return nil, fmt.Errorf("DoH resolver is not configured")
	}
	var errs []string
	for _, p := range r.providers {
		ips, err := r.resolveProvider(ctx, p, host)
		if err == nil && len(ips) > 0 {
			return ips, nil
		}
		if err != nil {
			errs = append(errs, p.name+": "+err.Error())
		}
	}
	if seedIPs := r.seedIPsForHost(host); len(seedIPs) > 0 {
		return seedIPs, nil
	}
	if len(errs) == 0 {
		return nil, fmt.Errorf("DoH returned no public IPv4 addresses for %s", host)
	}
	return nil, fmt.Errorf("DoH resolution failed for %s: %s", host, strings.Join(errs, "; "))
}

func (r *dohResolver) resolveProvider(ctx context.Context, p dohProvider, host string) ([]string, error) {
	q := url.Values{"name": {host}, "type": {"A"}}
	endpoint := "https://" + p.host + p.path + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/dns-json")

	timeout := r.timeout
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	client := &http.Client{Transport: newBootstrapTransport(p), Timeout: timeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("HTTP %s", resp.Status)
	}
	var result struct {
		Status int `json:"Status"`
		Answer []struct {
			Type int    `json:"type"`
			Data string `json:"data"`
		} `json:"Answer"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode DNS JSON: %w", err)
	}
	if result.Status != 0 {
		return nil, fmt.Errorf("DNS status %d", result.Status)
	}
	ips := make([]string, 0, len(result.Answer))
	seen := map[string]bool{}
	for _, a := range result.Answer {
		if a.Type != 1 {
			continue
		}
		ip := net.ParseIP(strings.TrimSpace(a.Data))
		if !isPublicIPv4(ip) {
			continue
		}
		value := ip.String()
		if !seen[value] {
			seen[value] = true
			ips = append(ips, value)
		}
		if len(ips) >= 8 {
			break
		}
	}
	if len(ips) == 0 {
		return nil, fmt.Errorf("no public A records")
	}
	return ips, nil
}

func newBootstrapTransport(p dohProvider) *http.Transport {
	d := &net.Dialer{Timeout: 3 * time.Second, KeepAlive: -1}
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err == nil && strings.EqualFold(host, p.host) {
				var lastErr error
				for _, ip := range p.bootstrap {
					conn, dialErr := d.DialContext(ctx, network, net.JoinHostPort(ip, port))
					if dialErr == nil {
						return conn, nil
					}
					lastErr = dialErr
				}
				if lastErr != nil {
					return nil, lastErr
				}
			}
			return d.DialContext(ctx, network, addr)
		},
		ForceAttemptHTTP2:   false,
		DisableKeepAlives:   true,
		TLSHandshakeTimeout: 3 * time.Second,
		TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
	}
}

func newDirectHostTransport(host, ip string) http.RoundTripper {
	d := &net.Dialer{Timeout: 4 * time.Second, KeepAlive: -1}
	return &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			targetHost, port, err := net.SplitHostPort(addr)
			if err == nil && strings.EqualFold(targetHost, host) {
				return d.DialContext(ctx, network, net.JoinHostPort(ip, port))
			}
			return d.DialContext(ctx, network, addr)
		},
		ForceAttemptHTTP2:   false,
		DisableKeepAlives:   true,
		TLSHandshakeTimeout: 4 * time.Second,
		TLSClientConfig:     tlsConfigForDirectHost(host),
	}
}

func (t *tmdbFallbackTransport) roundTripFallback(req *http.Request, host string, cause error) (*http.Response, error) {
	if t.resolver == nil {
		return nil, cause
	}
	ips, resolveErr := t.resolver.ResolveA(req.Context(), host)
	if resolveErr != nil {
		return nil, fmt.Errorf("%w; TMDB DNS fallback failed for %s: %v", cause, host, resolveErr)
	}
	factory := t.directFactory
	if factory == nil {
		factory = newDirectHostTransport
	}
	var fallbackErrs []string
	for _, ip := range ips {
		retry := req.Clone(req.Context())
		if req.GetBody != nil {
			body, err := req.GetBody()
			if err != nil {
				fallbackErrs = append(fallbackErrs, ip+": replay body: "+err.Error())
				continue
			}
			retry.Body = body
		}
		rt := factory(host, ip)
		response, err := rt.RoundTrip(retry)
		if err == nil {
			return response, nil
		}
		fallbackErrs = append(fallbackErrs, ip+": "+err.Error())
	}
	if len(fallbackErrs) == 0 {
		return nil, fmt.Errorf("%w; TMDB DNS fallback returned no usable addresses for %s", cause, host)
	}
	return nil, fmt.Errorf("%w; TMDB direct fallback failed for %s: %s", cause, host, strings.Join(fallbackErrs, "; "))
}

func (t *tmdbFallbackTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req == nil || req.URL == nil {
		return nil, fmt.Errorf("invalid HTTP request")
	}
	host := req.URL.Hostname()

	// RC3.30: the user's QNAP resolver returns 127.0.0.1 for image.tmdb.org,
	// which sends HTTPS to the NAS itself and presents the self-signed "QNAP NAS"
	// certificate. Never consult the system resolver for artwork. Resolve only via
	// DoH/host-specific public seeds and keep SNI/hostname as image.tmdb.org.
	if strings.EqualFold(host, tmdbImageHost) {
		if req.Body != nil && req.GetBody == nil {
			return nil, fmt.Errorf("TMDB image request body cannot be replayed")
		}
		return t.roundTripFallback(req, host, fmt.Errorf("system DNS bypassed for %s", host))
	}

	primary := t.primary
	if primary == nil {
		primary = http.DefaultTransport
	}
	resp, primaryErr := primary.RoundTrip(req)
	if primaryErr == nil {
		return resp, nil
	}
	if !isTMDBFallbackHost(host) {
		return nil, primaryErr
	}
	if req.Body != nil && req.GetBody == nil {
		return nil, primaryErr
	}
	return t.roundTripFallback(req, host, primaryErr)
}

func publicIPv4List(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		ip := net.ParseIP(strings.TrimSpace(value))
		if !isPublicIPv4(ip) {
			continue
		}
		s := ip.String()
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func isPublicIPv4(ip net.IP) bool {
	v4 := ip.To4()
	if v4 == nil {
		return false
	}
	if v4[0] == 0 || v4[0] == 10 || v4[0] == 127 || v4[0] >= 224 {
		return false
	}
	if v4[0] == 169 && v4[1] == 254 {
		return false
	}
	if v4[0] == 172 && v4[1] >= 16 && v4[1] <= 31 {
		return false
	}
	if v4[0] == 192 && v4[1] == 168 {
		return false
	}
	if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
		return false
	}
	return true
}
