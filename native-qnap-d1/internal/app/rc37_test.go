package app

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestIncrementalScanReusesUnchangedProfile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Movie.2026.mkv")
	if err := os.WriteFile(path, []byte("not-a-real-video"), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := Config{MediaRoot: root, MediaBaseURL: "http://nas/media/"}
	movies, _, _, first, err := ScanLocalIncremental(cfg, State{})
	if err != nil || len(movies) != 1 || first.Profiled != 1 {
		t.Fatalf("first scan err=%v movies=%d stats=%+v", err, len(movies), first)
	}
	previous := State{Movies: movies}
	movies2, _, _, second, err := ScanLocalIncremental(cfg, previous)
	if err != nil || len(movies2) != 1 || second.Reused != 1 || second.Profiled != 0 {
		t.Fatalf("second scan err=%v movies=%d stats=%+v", err, len(movies2), second)
	}
}

func TestIncrementalScanProfilesChangedFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "Movie.2026.mkv")
	if err := os.WriteFile(path, []byte("one"), 0644); err != nil {
		t.Fatal(err)
	}
	cfg := Config{MediaRoot: root, MediaBaseURL: "http://nas/media/"}
	movies, _, _, _, err := ScanLocalIncremental(cfg, State{})
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond)
	if err := os.WriteFile(path, []byte("changed-content"), 0644); err != nil {
		t.Fatal(err)
	}
	_, _, _, stats, err := ScanLocalIncremental(cfg, State{Movies: movies})
	if err != nil || stats.Profiled != 1 || stats.Reused != 0 {
		t.Fatalf("err=%v stats=%+v", err, stats)
	}
}

func TestProgressRecoversFromBackup(t *testing.T) {
	dir := t.TempDir()
	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetProgress(Progress{SourceURL: "movie", PositionMS: 1000, DurationMS: 5000}); err != nil {
		t.Fatal(err)
	}
	if err := store.SetProgress(Progress{SourceURL: "movie", PositionMS: 2000, DurationMS: 5000}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "progress.json"), []byte("{broken"), 0644); err != nil {
		t.Fatal(err)
	}
	recovered, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	p := recovered.GetProgress("movie")
	if p.PositionMS != 1000 {
		t.Fatalf("backup not recovered: %+v", p)
	}
}

func TestCompatibilityClassifiesDTSOnly(t *testing.T) {
	compatibility, reason := classifyCompatibility(MediaProfile{Probed: true, VideoCodec: "h264", AudioCodecs: []string{"dca"}})
	if compatibility != "dts_only" || reason != "audio_transcode_recommended" {
		t.Fatalf("%s %s", compatibility, reason)
	}
}

func TestTMDBImageCacheRejectsForeignHosts(t *testing.T) {
	if _, err := validateTMDBImageURL("https://image.tmdb.org/t/p/w500/a.jpg"); err != nil {
		t.Fatal(err)
	}
	if _, err := validateTMDBImageURL("https://example.com/a.jpg"); err == nil {
		t.Fatal("foreign image host accepted")
	}
}

func TestNextEpisodeAPI(t *testing.T) {
	dir := t.TempDir()
	store, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	state := State{NextID: 10, Shows: []Show{{ID: 1, Title: "Show"}}, Episodes: []Episode{
		{ID: 2, ShowID: 1, Season: 1, Episode: 1, SourceURL: "http://nas/media/e1.mkv", Title: "One"},
		{ID: 3, ShowID: 1, Season: 1, Episode: 2, SourceURL: "http://nas/media/e2.mkv", Title: "Two"},
	}}
	if err := store.SetState(state); err != nil {
		t.Fatal(err)
	}
	server := &Server{store: store}
	req := httptest.NewRequest("GET", "/api/next?source_url=http%3A%2F%2Fnas%2Fmedia%2Fe1.mkv", nil)
	res := httptest.NewRecorder()
	server.nextEpisode(res, req)
	if res.Code != 200 || !containsBytes(res.Body.Bytes(), []byte("e2.mkv")) {
		t.Fatalf("code=%d body=%s", res.Code, res.Body.String())
	}
}

func containsBytes(haystack, needle []byte) bool {
	if len(needle) == 0 {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := range needle {
			if haystack[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
