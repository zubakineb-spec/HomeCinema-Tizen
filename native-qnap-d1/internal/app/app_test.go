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
func TestParseSeriesSeason(t *testing.T) {
	p, ok := ParseMedia("Series/Fallout/Season 01/Fallout.S01E02.2160p.mkv")
	if !ok || p.Kind != "episode" || p.ShowTitle != "Fallout" || p.Season != 1 || p.Episode != 2 {
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
