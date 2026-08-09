package app

import (
	"strings"
	"testing"
)

func TestAudioSidecarArgsAreAudioOnlyFragmentedMP4(t *testing.T) {
	args := audioSidecarArgs("/media/movie.mkv", 3, 90500)
	joined := strings.Join(args, " ")
	checks := []string{
		"-ss 90.500",
		"-map 0:3",
		"-vn",
		"-c:a aac",
		"-ac 2",
		"-b:a 192k",
		"-movflags frag_keyframe+empty_moov+default_base_moof",
		"-f mp4 pipe:1",
	}
	for _, want := range checks {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing %q in %q", want, joined)
		}
	}
	for _, forbidden := range []string{"-map 0:v:0", "-c:v", "video/mp4"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("audio sidecar unexpectedly contains %q: %q", forbidden, joined)
		}
	}
}
