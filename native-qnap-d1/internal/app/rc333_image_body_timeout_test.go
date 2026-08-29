package app

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type rc333RoundTripperFunc func(*http.Request) (*http.Response, error)

func (f rc333RoundTripperFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type rc333FailingBody struct {
	sent bool
}

func (b *rc333FailingBody) Read(p []byte) (int, error) {
	if !b.sent {
		b.sent = true
		copy(p, []byte("abc"))
		return 3, nil
	}
	return 0, errors.New("forced body read failure")
}

func (b *rc333FailingBody) Close() error { return nil }

func TestRC333ImageClientExtendsTimeoutWithoutMutatingMetadataClient(t *testing.T) {
	base := &http.Client{Transport: http.DefaultTransport, Timeout: 20 * time.Second}
	s := &Server{tmdb: &TMDB{client: base}}

	imageClient := s.tmdbImageHTTPClient()
	if imageClient == base {
		t.Fatal("image client must be a copy so metadata timeout is not mutated")
	}
	if base.Timeout != 20*time.Second {
		t.Fatalf("metadata timeout changed: %v", base.Timeout)
	}
	if imageClient.Timeout != tmdbImageRequestTimeout {
		t.Fatalf("image timeout=%v want=%v", imageClient.Timeout, tmdbImageRequestTimeout)
	}
	if imageClient.Transport != base.Transport {
		t.Fatal("image client must preserve the verified TMDB transport")
	}
}

func TestRC333ImageReadFailurePersistsExactDiagnostic(t *testing.T) {
	dataDir := t.TempDir()
	imageDir := filepath.Join(dataDir, "image-cache")

	rt := rc333RoundTripperFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			Status:        "200 OK",
			Header:        http.Header{"Content-Type": []string{"image/jpeg"}},
			Body:          &rc333FailingBody{},
			ContentLength: 74275,
			Request:       r,
		}, nil
	})

	s := &Server{
		cfg: Config{DataDir: dataDir, ImageCacheDir: imageDir},
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

	diagPath := filepath.Join(dataDir, rc332ImageTransportLog)
	data, err := os.ReadFile(diagPath)
	if err != nil {
		t.Fatalf("read diagnostic: %v", err)
	}
	text := string(data)
	for _, want := range []string{
		"host=image.tmdb.org",
		"path=/t/p/w500/example.jpg",
		"TMDB image body read failed after 3 bytes",
		"content_length=74275",
		"forced body read failure",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("diagnostic missing %q: %s", want, text)
		}
	}
}

func TestRC333FallbackImageClientAlsoUsesExtendedTimeout(t *testing.T) {
	s := &Server{}
	client := s.tmdbImageHTTPClient()
	if client == nil {
		t.Fatal("nil image client")
	}
	if client.Timeout != tmdbImageRequestTimeout {
		t.Fatalf("fallback image timeout=%v want=%v", client.Timeout, tmdbImageRequestTimeout)
	}
	if client.Transport == nil {
		t.Fatal("fallback image client lost TMDB transport")
	}
}

var _ io.ReadCloser = (*rc333FailingBody)(nil)
