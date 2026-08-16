package app

import (
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
)

type historyItem map[string]any

func progressPercent(p Progress) float64 {
	if p.DurationMS <= 0 {
		return 0
	}
	value := float64(p.PositionMS) * 100 / float64(p.DurationMS)
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func preferredDisplayTitle(raw, recognized string) string {
	if strings.TrimSpace(recognized) != "" {
		return strings.TrimSpace(recognized)
	}
	return strings.TrimSpace(raw)
}

func showDisplayTitle(st State, showID int) (title, backdrop, poster string) {
	for _, show := range st.Shows {
		if show.ID == showID {
			return preferredDisplayTitle(show.Title, show.RecognizedTitle), show.BackdropURL, show.PosterURL
		}
	}
	return "", "", ""
}

func historyItems(st State, includeCompleted bool) []historyItem {
	items := []historyItem{}
	for _, p := range st.Progress {
		if p.PositionMS <= 0 || p.DurationMS <= 0 {
			continue
		}
		if !includeCompleted && p.Completed != 0 {
			continue
		}
		for _, m := range st.Movies {
			if m.SourceURL != p.SourceURL {
				continue
			}
			items = append(items, historyItem{
				"media_type": "movie", "id": m.ID, "title": preferredDisplayTitle(m.Title, m.RecognizedTitle),
				"source_url": m.SourceURL, "image_url": m.PosterURL, "backdrop_url": m.BackdropURL,
				"position_ms": p.PositionMS, "duration_ms": p.DurationMS, "updated_at": p.UpdatedAt,
				"completed": p.Completed, "progress_percent": progressPercent(p),
				"media_profile": m.MediaProfile,
			})
		}
		for _, episode := range st.Episodes {
			if episode.SourceURL != p.SourceURL {
				continue
			}
			parent, backdrop, poster := showDisplayTitle(st, episode.ShowID)
			image := episode.StillURL
			if image == "" {
				image = backdrop
			}
			if image == "" {
				image = poster
			}
			mediaType := "episode"
			if isExtra(episode) {
				mediaType = "extra"
			}
			item := historyItem{
				"media_type": mediaType, "id": episode.ID, "title": episode.Title, "parent_title": parent,
				"source_url": episode.SourceURL, "image_url": image, "backdrop_url": backdrop,
				"position_ms": p.PositionMS, "duration_ms": p.DurationMS, "updated_at": p.UpdatedAt,
				"completed": p.Completed, "show_id": episode.ShowID, "progress_percent": progressPercent(p),
				"media_profile": episode.MediaProfile,
			}
			if !isExtra(episode) {
				item["season"] = episode.Season
				item["episode"] = episode.Episode
			}
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool {
		return fmt.Sprint(items[i]["updated_at"]) > fmt.Sprint(items[j]["updated_at"])
	})
	return items
}

func sortedShowEpisodes(st State, showID int) []Episode {
	episodes := []Episode{}
	for _, ep := range st.Episodes {
		if ep.ShowID == showID && !isExtra(ep) {
			episodes = append(episodes, ep)
		}
	}
	sort.Slice(episodes, func(i, j int) bool {
		if episodes[i].Season == episodes[j].Season {
			return episodes[i].Episode < episodes[j].Episode
		}
		return episodes[i].Season < episodes[j].Season
	})
	return episodes
}

func nextEpisodeAfter(st State, showID int, sourceURL string) *Episode {
	episodes := sortedShowEpisodes(st, showID)
	for i := range episodes {
		if episodes[i].SourceURL == sourceURL && i+1 < len(episodes) {
			next := episodes[i+1]
			return &next
		}
	}
	return nil
}

func continueItemForEpisode(st State, ep Episode, activityAt string) historyItem {
	parent, backdrop, poster := showDisplayTitle(st, ep.ShowID)
	image := ep.StillURL
	if image == "" {
		image = backdrop
	}
	if image == "" {
		image = poster
	}
	item := historyItem{
		"media_type": "episode", "id": ep.ID, "title": ep.Title, "parent_title": parent,
		"source_url": ep.SourceURL, "image_url": image, "backdrop_url": backdrop,
		"position_ms": int64(0), "duration_ms": int64(ep.Runtime) * 60 * 1000,
		"updated_at": activityAt, "completed": 0, "progress_percent": float64(0),
		"show_id": ep.ShowID, "season": ep.Season, "episode": ep.Episode,
		"media_profile": ep.MediaProfile,
	}
	return item
}

// continueItems implements streaming-style series resume semantics. Only the most
// recent activity for a show is considered. If that episode is unfinished, resume
// it. If it is completed, continue from the immediately following episode instead
// of resurfacing an older unfinished episode from the same series.
func continueItems(st State) []historyItem {
	all := historyItems(st, true)
	out := []historyItem{}
	seenShows := map[int]bool{}
	for _, item := range all {
		mediaType := fmt.Sprint(item["media_type"])
		if mediaType == "episode" {
			showID, _ := item["show_id"].(int)
			if showID == 0 {
				if n, ok := item["show_id"].(float64); ok {
					showID = int(n)
				}
			}
			if showID <= 0 || seenShows[showID] {
				continue
			}
			seenShows[showID] = true
			completed := fmt.Sprint(item["completed"]) == "1"
			if !completed {
				out = append(out, item)
				continue
			}
			next := nextEpisodeAfter(st, showID, fmt.Sprint(item["source_url"]))
			if next != nil {
				out = append(out, continueItemForEpisode(st, *next, fmt.Sprint(item["updated_at"])))
			}
			continue
		}
		if mediaType == "movie" {
			if fmt.Sprint(item["completed"]) != "1" {
				out = append(out, item)
			}
			continue
		}
		if mediaType == "extra" && fmt.Sprint(item["completed"]) != "1" {
			out = append(out, item)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return fmt.Sprint(out[i]["updated_at"]) > fmt.Sprint(out[j]["updated_at"])
	})
	return out
}

func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	items := historyItems(s.store.Snapshot(), true)
	limit := 50
	if len(items) > limit {
		items = items[:limit]
	}
	jsonOut(w, map[string]any{"items": items})
}

func (s *Server) nextEpisode(w http.ResponseWriter, r *http.Request) {
	source := originalSource(strings.TrimSpace(r.URL.Query().Get("source_url")))
	st := s.store.Snapshot()
	var current *Episode
	for i := range st.Episodes {
		if st.Episodes[i].SourceURL == source && !isExtra(st.Episodes[i]) {
			current = &st.Episodes[i]
			break
		}
	}
	if current == nil {
		jsonOut(w, map[string]any{"item": nil})
		return
	}
	episodes := sortedShowEpisodes(st, current.ShowID)
	for index := range episodes {
		if episodes[index].SourceURL != source || index+1 >= len(episodes) {
			continue
		}
		next := episodes[index+1]
		showTitle, _, _ := showDisplayTitle(st, next.ShowID)
		p := st.Progress[next.SourceURL]
		jsonOut(w, map[string]any{"item": map[string]any{
			"id": next.ID, "show_id": next.ShowID, "parent_title": showTitle,
			"season": next.Season, "episode": next.Episode, "title": next.Title,
			"source_url": next.SourceURL, "still_url": next.StillURL,
			"watched": p.Completed != 0, "progress_percent": progressPercent(p),
			"media_profile": next.MediaProfile,
		}})
		return
	}
	jsonOut(w, map[string]any{"item": nil})
}

func countImageCache(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() && !strings.HasSuffix(entry.Name(), ".tmp") {
			count++
		}
	}
	return count
}

func (s *Server) diagnostics(w http.ResponseWriter, r *http.Request) {
	st := s.store.Snapshot()
	compat := map[string]int{}
	profiled := 0
	for _, movie := range st.Movies {
		compat[movie.MediaProfile.Compatibility]++
		if movie.MediaProfile.Probed {
			profiled++
		}
	}
	for _, episode := range st.Episodes {
		compat[episode.MediaProfile.Compatibility]++
		if episode.MediaProfile.Probed {
			profiled++
		}
	}
	jsonOut(w, map[string]any{
		"status": "ok", "version": Version, "runtime": "qnap-d1-native-armv7",
		"movies": len(st.Movies), "shows": len(st.Shows), "episodes_and_extras": len(st.Episodes),
		"progress_entries": len(st.Progress), "profiled_files": profiled,
		"compatibility": compat, "image_cache_entries": countImageCache(s.cfg.ImageCacheDir),
		"media_root": s.cfg.MediaRoot, "media_base_url": s.cfg.MediaBaseURL,
		"ffmpeg": tool("ffmpeg"), "ffprobe": tool("ffprobe"),
	})
}
