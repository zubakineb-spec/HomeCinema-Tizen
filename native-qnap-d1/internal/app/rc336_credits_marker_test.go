package app

import "testing"

func TestRC336CreditsUseFirstQualifyingChapter(t *testing.T) {
	chapters := []profileProbeChapter{
		{StartTime: "0.000", EndTime: "70.000", Tags: map[string]string{"title": "Opening / Intro"}},
		{StartTime: "70.000", EndTime: "2520.000", Tags: map[string]string{"title": "Episode"}},
		{StartTime: "2520.000", EndTime: "2670.000", Tags: map[string]string{"title": "End Credits"}},
		{StartTime: "2670.000", EndTime: "2700.000", Tags: map[string]string{"title": "Closing Credits"}},
	}

	_, credits := detectChapterMarkers(chapters, 2700000)
	if credits != 2520000 {
		t.Fatalf("credits got %d want 2520000 (first credits chapter)", credits)
	}
}

func TestRC336OpeningCreditsStillIgnored(t *testing.T) {
	chapters := []profileProbeChapter{
		{StartTime: "12.000", EndTime: "72.000", Tags: map[string]string{"title": "Opening Credits"}},
		{StartTime: "2480.000", EndTime: "2630.000", Tags: map[string]string{"title": "End Credits"}},
		{StartTime: "2630.000", EndTime: "2700.000", Tags: map[string]string{"title": "Outro"}},
	}

	_, credits := detectChapterMarkers(chapters, 2700000)
	if credits != 2480000 {
		t.Fatalf("credits got %d want 2480000", credits)
	}
}

func TestRC336OldCachedProfileRequiresReprobe(t *testing.T) {
	old := MediaProfile{ProfileVersion: rc316ProfileVersion, Probed: true, AudioCodecs: []string{"ac3"}, AudioTracks: []AudioTrackProfile{{Codec: "ac3"}}}
	if reusableMediaProfile(old) {
		t.Fatal("RC3.16 cached profile must be reprofiled for corrected credits markers")
	}

	current := old
	current.ProfileVersion = creditsMarkerProfileVersion
	if !reusableMediaProfile(current) {
		t.Fatal("profile 317 should be reusable")
	}
}