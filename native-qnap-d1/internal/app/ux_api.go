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
				"media_type": "movie", "id": m.ID, "title": m.Title,
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
			parent, backdrop, poster := "", "", ""
			for _, show := range st.Shows {
				if show.ID == episode.ShowID {
					parent, backdrop, poster = show.Title, show.BackdropURL, show.PosterURL
					break
				}
			}
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
	episodes := []Episode{}
	for _, episode := range st.Episodes {
		if episode.ShowID == current.ShowID && !isExtra(episode) {
			episodes = append(episodes, episode)
		}
	}
	sort.Slice(episodes, func(i, j int) bool {
		if episodes[i].Season == episodes[j].Season {
			return episodes[i].Episode < episodes[j].Episode
		}
		return episodes[i].Season < episodes[j].Season
	})
	for index := range episodes {
		if episodes[index].SourceURL != source || index+1 >= len(episodes) {
			continue
		}
		next := episodes[index+1]
		showTitle := ""
		for _, show := range st.Shows {
			if show.ID == next.ShowID {
				showTitle = show.Title
				break
			}
		}
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
