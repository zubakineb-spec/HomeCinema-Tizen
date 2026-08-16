package app

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type ScanStats struct {
	Files    int `json:"files"`
	Reused   int `json:"reused"`
	Profiled int `json:"profiled"`
	Removed  int `json:"removed"`
}

func publicURL(base, rel string) string {
	parts := strings.Split(filepath.ToSlash(rel), "/")
	for i := range parts {
		parts[i] = url.PathEscape(parts[i])
	}
	return strings.TrimRight(base, "/") + "/" + strings.Join(parts, "/")
}

func skipQNAPDir(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	if strings.HasPrefix(lower, ".@") {
		return true
	}
	switch lower {
	case "@recycle", "@transcode", "@recently-snapshot", ".streams":
		return true
	default:
		return false
	}
}

func reusableMediaProfile(profile MediaProfile) bool {
	// RC3.14 added per-track audio metadata. A file probed by an older release can
	// have audio codecs but no AudioTracks; force exactly one reprobe after upgrade.
	if profile.Probed && len(profile.AudioCodecs) > 0 && len(profile.AudioTracks) == 0 {
		return false
	}
	return true
}

func ScanLocal(cfg Config) ([]Movie, []Show, []Episode, error) {
	movies, shows, episodes, _, err := ScanLocalIncremental(cfg, State{})
	return movies, shows, episodes, err
}

func ScanLocalIncremental(cfg Config, previous State) ([]Movie, []Show, []Episode, ScanStats, error) {
	var movies []Movie
	var shows []Show
	var episodes []Episode
	stats := ScanStats{}
	showTemp := map[string]int{}
	nextTemp := 1
	oldMovies := map[string]Movie{}
	oldEpisodes := map[string]Episode{}
	oldSources := map[string]bool{}
	seenSources := map[string]bool{}
	for _, item := range previous.Movies {
		oldMovies[item.SourceURL] = item
		oldSources[item.SourceURL] = true
	}
	for _, item := range previous.Episodes {
		oldEpisodes[item.SourceURL] = item
		oldSources[item.SourceURL] = true
	}

	err := filepath.Walk(cfg.MediaRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if path != cfg.MediaRoot && skipQNAPDir(info.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, e := filepath.Rel(cfg.MediaRoot, path)
		if e != nil {
			return nil
		}
		parsed, ok := ParseMedia(rel)
		if !ok {
			return nil
		}
		src := publicURL(cfg.MediaBaseURL, rel)
		seenSources[src] = true
		stats.Files++
		fileSize := info.Size()
		fileMTime := info.ModTime().Unix()
		profile := MediaProfile{}
		reused := false
		if parsed.Kind == "movie" {
			if old, ok := oldMovies[src]; ok && old.FileSize == fileSize && old.FileMTime == fileMTime && reusableMediaProfile(old.MediaProfile) {
				profile = old.MediaProfile
				reused = true
			}
		} else if old, ok := oldEpisodes[src]; ok && old.FileSize == fileSize && old.FileMTime == fileMTime && reusableMediaProfile(old.MediaProfile) {
			profile = old.MediaProfile
			reused = true
		}
		if reused {
			stats.Reused++
		} else {
			profile = profileLocalFile(path)
			stats.Profiled++
		}

		if parsed.Kind == "movie" {
			movies = append(movies, Movie{
				SourceURL: src, Title: parsed.Title, Year: parsed.Year, MetadataStatus: "pending",
				FileSize: fileSize, FileMTime: fileMTime, MediaProfile: profile,
			})
			return nil
		}

		key := strings.ToLower(parsed.ShowTitle)
		tid, ok := showTemp[key]
		if !ok {
			tid = nextTemp
			nextTemp++
			showTemp[key] = tid
			shows = append(shows, Show{ID: tid, Title: parsed.ShowTitle, MetadataStatus: "pending"})
		}

		contentType := "episode"
		metadataStatus := "pending"
		if parsed.Kind == "extra" {
			contentType = "extra"
			metadataStatus = "local"
		}
		episodes = append(episodes, Episode{
			ShowID: tid, SourceURL: src, Season: parsed.Season, Episode: parsed.Episode,
			Title: parsed.Title, ContentType: contentType, MetadataStatus: metadataStatus,
			FileSize: fileSize, FileMTime: fileMTime, MediaProfile: profile,
		})
		return nil
	})
	if os.IsNotExist(err) {
		return nil, nil, nil, stats, fmt.Errorf("media root not found: %s", cfg.MediaRoot)
	}
	for source := range oldSources {
		if !seenSources[source] {
			stats.Removed++
		}
	}
	sort.Slice(movies, func(i, j int) bool { return movies[i].Title < movies[j].Title })
	sort.Slice(shows, func(i, j int) bool { return shows[i].Title < shows[j].Title })
	return movies, shows, episodes, stats, err
}
