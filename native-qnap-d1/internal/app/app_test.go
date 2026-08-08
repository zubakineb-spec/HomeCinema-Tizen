package app

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestParseMovie(t *testing.T) {
	p, ok := ParseMedia("Films/Interstellar.2014.2160p.HDR.mkv")
	if !ok || p.Kind != "movie" || p.Title != "Interstellar" || p.Year != 2014 {
		t.Fatalf("%+v %v", p, ok)
	}
}
func TestParseRealMovieReleaseNames(t *testing.T) {
	tests := []struct {
		path  string
		title string
		year  int
	}{
		{"Evil.Dead.Burn.2026.MA.x264.WEB-DL.1080p.mkv", "Evil Dead Burn", 2026},
		{"Proisshestvie.v.strane.Multi-Pulti.2022.WEBRip.1080p.mkv", "Proisshestvie v strane Multi-Pulti", 2022},
		{"Rio.de.Sangue.2026.1080p.WEB-DL.H264_il68k.mkv", "Rio de Sangue", 2026},
		{"Scary Movie.2026.DCPRip.H264.2.0.mkv", "Scary Movie", 2026},
		{"Soulm8te.1080p.mkv", "Soulm8te", 0},
		{"Tchaikovsky The Nutcracker  Mariinsky Gergiev (2012) 720p BDRip/Tchaikovsky_The.Nutcracker_Mariinsky.Theatre_Gergiev.2012.BDRip.720p.mkv", "Tchaikovsky The Nutcracker Mariinsky Theatre Gergiev", 2012},
		{"The.Sheep.Detectives.2026.1080p.AMZN.WEB-DL.H.264-EniaHD.mkv", "The Sheep Detectives", 2026},
		{"Tuner.2025.1080p.WEB.H.264.mkv", "Tuner", 2025},
	}
	for _, tc := range tests {
		p, ok := ParseMedia(tc.path)
		if !ok || p.Kind != "movie" || p.Title != tc.title || p.Year != tc.year {
			t.Errorf("%s => %+v ok=%v; want title=%q year=%d", tc.path, p, ok, tc.title, tc.year)
		}
	}
}
func TestParseSeriesSeason(t *testing.T) {
	p, ok := ParseMedia("Series/Fallout/Season 01/Fallout.S01E02.2160p.mkv")
	if !ok || p.Kind != "episode" || p.ShowTitle != "Fallout" || p.Season != 1 || p.Episode != 2 {
		t.Fatalf("%+v", p)
	}
}
func TestParseSeriesDottedEpisodeAndReleaseDir(t *testing.T) {
	p, ok := ParseMedia("The.Dark.S01.2026.WEB-DL.1080p.ExKinoRay/The.Dark.S01.E05.2026.WEB-DL.1080p.ExKinoRay.mkv")
	if !ok || p.Kind != "episode" || p.ShowTitle != "The Dark" || p.Season != 1 || p.Episode != 5 {
		t.Fatalf("%+v", p)
	}
}
func TestParseSeriesReleaseDirectoryTitle(t *testing.T) {
	p, ok := ParseMedia("After Life S01 (1080p)/After.Life.2019.S01E02.1080p.WEB-DL.KvK.mkv")
	if !ok || p.Kind != "episode" || p.ShowTitle != "After Life" || p.Season != 1 || p.Episode != 2 {
		t.Fatalf("%+v", p)
	}
}
func TestParseSeriesNumeric(t *testing.T) {
	p, ok := ParseMedia("Series/Игра престолов/Сезон 02/03.mkv")
	if !ok || p.ShowTitle != "Игра престолов" || p.Season != 2 || p.Episode != 3 {
		t.Fatalf("%+v", p)
	}
}
func TestSourceLocalTraversal(t *testing.T) {
	root := t.TempDir()
	cfg := Config{MediaRoot: root, MediaBaseURL: "http://192.168.0.101/"}
	if _, e := sourceLocal(cfg, "http://192.168.0.101/../etc/passwd"); e == nil {
		t.Fatal("traversal accepted")
	}
}
func TestScanBuildsPublicURL(t *testing.T) {
	root := t.TempDir()
	d := filepath.Join(root, "Series", "Fallout", "Season 01")
	if e := os.MkdirAll(d, 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(d, "01.mkv"), []byte("x"), 0644); e != nil {
		t.Fatal(e)
	}
	cfg := Config{MediaRoot: root, MediaBaseURL: "http://192.168.0.101/media/"}
	_, s, e, err := ScanLocal(cfg)
	if err != nil || len(s) != 1 || len(e) != 1 {
		t.Fatalf("%v %d %d", err, len(s), len(e))
	}
	u, err := url.Parse(e[0].SourceURL)
	if err != nil || u.Path != "/media/Series/Fallout/Season 01/01.mkv" {
		t.Fatalf("%s %v", e[0].SourceURL, err)
	}
}
func TestScanSkipsQNAPThumbDirectories(t *testing.T) {
	root := t.TempDir()
	d := filepath.Join(root, "After Life S01 (1080p)")
	thumb := filepath.Join(d, ".@__thumb")
	if e := os.MkdirAll(thumb, 0755); e != nil {
		t.Fatal(e)
	}
	name := "After.Life.2019.S01E01.1080p.WEB-DL.KvK.mkv"
	if e := os.WriteFile(filepath.Join(d, name), []byte("x"), 0644); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(thumb, "s800"+name), []byte("x"), 0644); e != nil {
		t.Fatal(e)
	}
	cfg := Config{MediaRoot: root, MediaBaseURL: "http://192.168.0.101:8096/media/"}
	m, s, e, err := ScanLocal(cfg)
	if err != nil || len(m) != 0 || len(s) != 1 || len(e) != 1 {
		t.Fatalf("err=%v movies=%d shows=%d episodes=%d", err, len(m), len(s), len(e))
	}
}
