package app

import (
	"path/filepath"
	"testing"
)

func TestRC314AudioAttributionDetection(t *testing.T) {
	cases := []struct {
		input       string
		studio      string
		translation string
	}{
		{"RUS MVO LostFilm AC3 5.1", "LostFilm", "MVO"},
		{"Русский дубляж | NewStudio", "NewStudio", "DUB"},
		{"Кураж-Бамбей авторский перевод", "Кураж-Бамбей", "AVO"},
		{"Кубик в Кубе двухголосый", "Кубик в Кубе", "DVO"},
		{"English Original DTS", "", "Original"},
	}
	for _, tc := range cases {
		if got := detectAudioStudio(tc.input); got != tc.studio {
			t.Fatalf("studio %q: got %q want %q", tc.input, got, tc.studio)
		}
		if got := detectTranslationType(tc.input); got != tc.translation {
			t.Fatalf("translation %q: got %q want %q", tc.input, got, tc.translation)
		}
	}
}

func TestRC314MediaLocalPath(t *testing.T) {
	cfg := Config{MediaBaseURL: "http://192.168.0.101:8096/media/", MediaRoot: filepath.Join("share", "Download")}
	got, ok := mediaLocalPath(cfg, "http://192.168.0.101:8096/media/Series/Show%20Name/S01E01.mkv")
	if !ok {
		t.Fatal("expected media URL to resolve")
	}
	want := filepath.Join(cfg.MediaRoot, "Series", "Show Name", "S01E01.mkv")
	if got != want {
		t.Fatalf("path got %q want %q", got, want)
	}
	if _, ok := mediaLocalPath(cfg, "http://192.168.0.101:8096/media/../secret.mkv"); ok {
		t.Fatal("path traversal must be rejected")
	}
	if _, ok := mediaLocalPath(cfg, "http://example.com/media/movie.mkv"); ok {
		t.Fatal("foreign media host must be rejected")
	}
}

func TestRC314LegacyAudioProfileForcesOneReprobe(t *testing.T) {
	legacy := MediaProfile{Probed: true, AudioCodecs: []string{"ac3"}}
	if reusableMediaProfile(legacy) {
		t.Fatal("legacy profiled file without AudioTracks must be re-probed after RC3.14/RC3.15 upgrade")
	}
	current := MediaProfile{
		ProfileVersion: mediaProfileVersion,
		Probed:         true,
		AudioCodecs:    []string{"ac3"},
		AudioTracks:    []AudioTrackProfile{{Codec: "ac3", Channels: 6}},
	}
	if !reusableMediaProfile(current) {
		t.Fatal("current profile with AudioTracks should remain reusable")
	}
	legacyUnprobed := MediaProfile{Probed: false}
	if reusableMediaProfile(legacyUnprobed) {
		t.Fatal("legacy extension-only profile must receive the RC3.15 profile version once")
	}
	currentUnprobed := MediaProfile{ProfileVersion: mediaProfileVersion, Probed: false}
	if !reusableMediaProfile(currentUnprobed) {
		t.Fatal("current extension-only profile should not be re-probed forever when ffprobe is unavailable")
	}
}
