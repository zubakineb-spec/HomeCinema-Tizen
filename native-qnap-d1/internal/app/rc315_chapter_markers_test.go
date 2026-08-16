package app

import "testing"

func TestRC315ChapterMarkers(t *testing.T) {
	chapters := []profileProbeChapter{
		{StartTime: "0.000", EndTime: "72.500", Tags: map[string]string{"title": "Opening / Intro"}},
		{StartTime: "72.500", EndTime: "2520.000", Tags: map[string]string{"title": "Episode"}},
		{StartTime: "2520.000", EndTime: "2700.000", Tags: map[string]string{"title": "End Credits"}},
	}
	intro, credits := detectChapterMarkers(chapters, 2700000)
	if intro != 72500 {
		t.Fatalf("intro got %d want 72500", intro)
	}
	if credits != 2520000 {
		t.Fatalf("credits got %d want 2520000", credits)
	}
}

func TestRC315OpeningCreditsAreNotEndCredits(t *testing.T) {
	chapters := []profileProbeChapter{
		{StartTime: "10.000", EndTime: "70.000", Tags: map[string]string{"title": "Opening Credits"}},
		{StartTime: "2500.000", EndTime: "2700.000", Tags: map[string]string{"title": "Титры"}},
	}
	_, credits := detectChapterMarkers(chapters, 2700000)
	if credits != 2500000 {
		t.Fatalf("credits got %d want 2500000", credits)
	}
}

func TestRC315LegacyProfileRequiresReprobe(t *testing.T) {
	legacy := MediaProfile{Probed: true, AudioCodecs: []string{"ac3"}, AudioTracks: []AudioTrackProfile{{Codec: "ac3"}}}
	if reusableMediaProfile(legacy) {
		t.Fatal("legacy profile without profile_version must be reprofiled")
	}
	current := legacy
	current.ProfileVersion = mediaProfileVersion
	if !reusableMediaProfile(current) {
		t.Fatal("RC3.15 profile should be reusable")
	}
}
