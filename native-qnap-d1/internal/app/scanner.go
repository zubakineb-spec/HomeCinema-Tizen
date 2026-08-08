package app

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func publicURL(base, rel string) string {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.TrimRight(base, "/") + "/" + strings.Join(parts, "/")
}

func ScanLocal(cfg Config) ([]Movie, []Show, []Episode, error) {
	var movies []Movie
	var shows []Show
	var episodes []Episode
	showTemp := map[string]int{}
	nextTemp := 1
	err := filepath.Walk(cfg.MediaRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		rel, e := filepath.Rel(cfg.MediaRoot, path)
		if e != nil {
			return nil
		}
		p, ok := ParseMedia(rel)
		if !ok {
			return nil
		}
		src := publicURL(cfg.MediaBaseURL, rel)
		if p.Kind == "movie" {
			movies = append(movies, Movie{SourceURL: src, Title: p.Title, Year: p.Year, MetadataStatus: "pending"})
		} else {
			key := strings.ToLower(p.ShowTitle)
			tid, ok := showTemp[key]
			if !ok {
				tid = nextTemp
				nextTemp++
				showTemp[key] = tid
				shows = append(shows, Show{ID: tid, Title: p.ShowTitle, MetadataStatus: "pending"})
			}
			episodes = append(episodes, Episode{ShowID: tid, SourceURL: src, Season: p.Season, Episode: p.Episode, Title: p.Title, MetadataStatus: "pending"})
		}
		return nil
	})
	if os.IsNotExist(err) {
		return nil, nil, nil, fmt.Errorf("media root not found: %s", cfg.MediaRoot)
	}
	sort.Slice(movies, func(i, j int) bool { return movies[i].Title < movies[j].Title })
	sort.Slice(shows, func(i, j int) bool { return shows[i].Title < shows[j].Title })
	return movies, shows, episodes, err
}
