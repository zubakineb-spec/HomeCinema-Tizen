package app

import (
	"strings"
	"testing"
)

func TestAudioSidecarArgsAreAudioOnlyAACADTS(t *testing.T) {
	args, contentType, err := audioSidecarArgs("/media/movie.mkv", 3, 90500, "aac")
	if err != nil {
		t.Fatalf("audioSidecarArgs error: %v", err)
	}
	if contentType != "audio/aac" {
		t.Fatalf("content type=%q", contentType)
	}
	joined := strings.Join(args, " ")
	checks := []string{
		"-ss 90.500",
		"-map 0:3",
		"-vn",
		"-sn",
		"-dn",
		"-c:a aac",
		"-profile:a aac_low",
		"-ac 2",
		"-ar 48000",
		"-b:a 192k",
		"-f adts pipe:1",
	}
	for _, want := range checks {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %q", want, joined)
		}
	}
	for _, forbidden := range []string{"-map 0:v:0", "-c:v", "-f mp4", "video/mp4"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("audio sidecar unexpectedly contains %q: %q", forbidden, joined)
		}
	}
}
