package app

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const artworkRepairCooldown = 6 * time.Hour

var artworkRepairState = struct {
	sync.Mutex
	last map[string]time.Time
}{last: map[string]time.Time{}}

func hasArtwork(posterURL, backdropURL string) bool {
	return strings.TrimSpace(posterURL) != "" || strings.TrimSpace(backdropURL) != ""
}

func shouldRepairArtwork(status string, tmdbID int, posterURL, backdropURL string) bool {
	return status == "matched" && tmdbID > 0 && !hasArtwork(posterURL, backdropURL)
}

func reserveArtworkRepair(key string, now time.Time) bool {
	artworkRepairState.Lock()
	defer artworkRepairState.Unlock()
	if previous, ok := artworkRepairState.last[key]; ok && now.Sub(previous) < artworkRepairCooldown {
		return false
	}
	artworkRepairState.last[key] = now
	return true
}

func (t *TMDB) movieByIDArtwork(id int) (details, error) {
	var d details
	err := t.get("/movie/"+strconv.Itoa(id), url.Values{"language": {"ru-RU"}}, &d)
	if err != nil {
		return details{}, err
	}
	if d.PosterPath != "" || d.BackdropPath != "" {
		return d, nil
	}
	var fallback details
	if fallbackErr := t.get("/movie/"+strconv.Itoa(id), url.Values{"language": {"en-US"}}, &fallback); fallbackErr == nil {
		if d.PosterPath == "" {
			d.PosterPath = fallback.PosterPath
		}
		if d.BackdropPath == "" {
			d.BackdropPath = fallback.BackdropPath
		}
	}
	return d, nil
}

func (t *TMDB) showByIDArtwork(id int) (details, error) {
	var d details
	err := t.get("/tv/"+strconv.Itoa(id), url.Values{"language": {"ru-RU"}}, &d)
	if err != nil {
		return details{}, err
	}
	if d.PosterPath != "" || d.BackdropPath != "" {
		return d, nil
	}
	var fallback details
	if fallbackErr := t.get("/tv/"+strconv.Itoa(id), url.Values{"language": {"en-US"}}, &fallback); fallbackErr == nil {
		if d.PosterPath == "" {
			d.PosterPath = fallback.PosterPath
		}
		if d.BackdropPath == "" {
			d.BackdropPath = fallback.BackdropPath
		}
	}
	return d, nil
}

func (s *Server) repairMissingArtwork() map[string]int {
	out := map[string]int{"movies_repaired": 0, "shows_repaired": 0}
	if s == nil || s.tmdb == nil || !s.tmdb.enabled() {
		return out
	}
	st := s.store.Snapshot()
	now := time.Now()
	changed := false

	for i := range st.Movies {
		m := &st.Movies[i]
		if !shouldRepairArtwork(m.MetadataStatus, m.TMDBID, m.PosterURL, m.BackdropURL) {
			continue
		}
		key := fmt.Sprintf("movie:%d", m.TMDBID)
		if !reserveArtworkRepair(key, now) {
			continue
		}
		d, err := s.tmdb.movieByIDArtwork(m.TMDBID)
		if err != nil {
			continue
		}
		poster := image(d.PosterPath, "w500")
		backdrop := image(d.BackdropPath, "w1280")
		if poster == "" && backdrop == "" {
			continue
		}
		m.PosterURL = poster
		m.BackdropURL = backdrop
		changed = true
		out["movies_repaired"]++
	}

	for i := range st.Shows {
		sh := &st.Shows[i]
		if !shouldRepairArtwork(sh.MetadataStatus, sh.TMDBID, sh.PosterURL, sh.BackdropURL) {
			continue
		}
		key := fmt.Sprintf("show:%d", sh.TMDBID)
		if !reserveArtworkRepair(key, now) {
			continue
		}
		d, err := s.tmdb.showByIDArtwork(sh.TMDBID)
		if err != nil {
			continue
		}
		poster := image(d.PosterPath, "w500")
		backdrop := image(d.BackdropPath, "w1280")
		if poster == "" && backdrop == "" {
			continue
		}
		sh.PosterURL = poster
		sh.BackdropURL = backdrop
		changed = true
		out["shows_repaired"]++
	}

	if changed {
		_ = s.store.SetState(st)
	}
	return out
}
