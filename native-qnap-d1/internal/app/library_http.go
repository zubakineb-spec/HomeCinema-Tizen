package app

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
)

func (s *Server) scan(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonErr(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	result, err := s.scanLibrary()
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOut(w, result)
}

func (s *Server) scanLibrary() (map[string]any, error) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()

	m, sh, ep, err := ScanLocal(s.cfg)
	if err != nil {
		return nil, err
	}
	if err = s.store.ReplaceScan(m, sh, ep); err != nil {
		return nil, err
	}
	matched := map[string]int{"movies_matched": 0, "shows_matched": 0, "episodes_matched": 0}
	if s.tmdb.enabled() {
		matched = s.enrich()
	}
	episodeCount, extraCount := 0, 0
	for _, item := range ep {
		if isExtra(item) { extraCount++ } else { episodeCount++ }
	}
	return map[string]any{
		"source": s.cfg.MediaRoot,
		"video_files": len(m) + len(ep),
		"movies": len(m),
		"shows": len(sh),
		"episodes": episodeCount,
		"extras": extraCount,
		"ignored": 0,
		"tmdb_enabled": s.tmdb.enabled(),
		"movies_matched": matched["movies_matched"],
		"shows_matched": matched["shows_matched"],
		"episodes_matched": matched["episodes_matched"],
	}, nil
}

func (s *Server) enrich() map[string]int {
	st := s.store.Snapshot()
	out := map[string]int{"movies_matched": 0, "shows_matched": 0, "episodes_matched": 0}
	for i := range st.Movies {
		if st.Movies[i].MetadataStatus == "matched" { continue }
		d, e := s.tmdb.Movie(st.Movies[i].Title, st.Movies[i].Year)
		if e == nil { d = s.tmdb.movieOverviewFallback(d) }
		if e == nil && d.ID > 0 {
			st.Movies[i].TMDBID = d.ID
			st.Movies[i].OriginalTitle = d.OriginalTitle
			st.Movies[i].Overview = d.Overview
			st.Movies[i].PosterURL = image(d.PosterPath, "w500")
			st.Movies[i].BackdropURL = image(d.BackdropPath, "w1280")
			st.Movies[i].Rating = d.Vote
			st.Movies[i].Runtime = d.Runtime
			st.Movies[i].Genres = names(d.Genres)
			st.Movies[i].MetadataStatus = "matched"
			out["movies_matched"]++
		}
	}
	for i := range st.Shows {
		preferredID := preferredTMDBShowID(st.Shows[i].Title)
		needsShowLookup := st.Shows[i].MetadataStatus != "matched" || (preferredID > 0 && st.Shows[i].TMDBID != preferredID)
		if needsShowLookup {
			var d details
			var e error
			if preferredID > 0 { d, e = s.tmdb.ShowByID(preferredID) } else { d, e = s.tmdb.Show(st.Shows[i].Title) }
			if e == nil { d = s.tmdb.showOverviewFallback(d) }
			if e == nil && d.ID > 0 {
				st.Shows[i].TMDBID = d.ID
				st.Shows[i].OriginalTitle = d.OriginalName
				st.Shows[i].Overview = d.Overview
				st.Shows[i].PosterURL = image(d.PosterPath, "w500")
				st.Shows[i].BackdropURL = image(d.BackdropPath, "w1280")
				st.Shows[i].Rating = d.Vote
				st.Shows[i].Genres = names(d.Genres)
				st.Shows[i].MetadataStatus = "matched"
				out["shows_matched"]++
			}
		}
		if st.Shows[i].TMDBID > 0 {
			for j := range st.Episodes {
				if st.Episodes[j].ShowID != st.Shows[i].ID || st.Episodes[j].MetadataStatus == "matched" || st.Episodes[j].MetadataStatus == "local" || isExtra(st.Episodes[j]) { continue }
				d, e := s.tmdb.Episode(st.Shows[i].TMDBID, st.Episodes[j].Season, st.Episodes[j].Episode)
				if e == nil { d = s.tmdb.episodeOverviewFallback(st.Shows[i].TMDBID, st.Episodes[j].Season, st.Episodes[j].Episode, d) }
				if e == nil {
					if d.Name != "" { st.Episodes[j].Title = d.Name }
					st.Episodes[j].Overview = d.Overview
					st.Episodes[j].StillURL = image(d.StillPath, "w780")
					st.Episodes[j].Runtime = d.Runtime
					st.Episodes[j].AirDate = d.AirDate
					st.Episodes[j].MetadataStatus = "matched"
					out["episodes_matched"]++
				}
			}
		}
	}
	_ = s.store.SetState(st)
	return out
}

func (s *Server) catalog(w http.ResponseWriter, r *http.Request) { jsonOut(w, Catalog(s.store.Snapshot())) }

func showCounts(st State, showID int) (episodeCount, seasonCount, extraCount int) {
	seasons := map[int]bool{}
	for _, e := range st.Episodes {
		if e.ShowID != showID { continue }
		if isExtra(e) { extraCount++; continue }
		episodeCount++; seasons[e.Season] = true
	}
	return episodeCount, len(seasons), extraCount
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	st := s.store.Snapshot()
	movies := []Movie{}
	shows := []map[string]any{}
	if q != "" {
		for _, m := range st.Movies {
			if strings.Contains(strings.ToLower(m.Title+" "+m.OriginalTitle), q) { movies = append(movies, m) }
		}
		for _, sh := range st.Shows {
			if strings.Contains(strings.ToLower(sh.Title+" "+sh.OriginalTitle), q) {
				episodeCount, seasonCount, extraCount := showCounts(st, sh.ID)
				x := toMap(sh); x["episode_count"] = episodeCount; x["season_count"] = seasonCount; x["extra_count"] = extraCount; shows = append(shows, x)
			}
		}
	}
	jsonOut(w, map[string]any{"movies": movies, "shows": shows})
}

func idTail(path, prefix string) (int, error) { return strconv.Atoi(strings.TrimPrefix(path, prefix)) }

func (s *Server) movie(w http.ResponseWriter, r *http.Request) {
	id, e := idTail(r.URL.Path, "/api/movies/")
	if e != nil { jsonErr(w, http.StatusNotFound, "Movie not found"); return }
	for _, m := range s.store.Snapshot().Movies { if m.ID == id { jsonOut(w, m); return } }
	jsonErr(w, http.StatusNotFound, "Movie not found")
}

func (s *Server) show(w http.ResponseWriter, r *http.Request) {
	id, e := idTail(r.URL.Path, "/api/shows/")
	if e != nil { jsonErr(w, http.StatusNotFound, "Show not found"); return }
	st := s.store.Snapshot()
	var found *Show
	for i := range st.Shows { if st.Shows[i].ID == id { found = &st.Shows[i]; break } }
	if found == nil { jsonErr(w, http.StatusNotFound, "Show not found"); return }
	eps := []Episode{}
	extras := []Episode{}
	for _, ep := range st.Episodes {
		if ep.ShowID != id { continue }
		if isExtra(ep) { extras = append(extras, ep) } else { eps = append(eps, ep) }
	}
	sort.Slice(eps, func(i, j int) bool { if eps[i].Season == eps[j].Season { return eps[i].Episode < eps[j].Episode }; return eps[i].Season < eps[j].Season })
	sort.Slice(extras, func(i, j int) bool { return extras[i].Title < extras[j].Title })
	res := toMap(*found); res["episodes"] = eps; res["extras"] = extras; res["extra_count"] = len(extras)
	seasonMap := map[int][]Episode{}
	for _, ep := range eps { seasonMap[ep.Season] = append(seasonMap[ep.Season], ep) }
	nums := []int{}; for n := range seasonMap { nums = append(nums, n) }; sort.Ints(nums)
	seasons := []map[string]any{}
	for _, n := range nums { seasons = append(seasons, map[string]any{"number": n, "episode_count": len(seasonMap[n]), "episodes": seasonMap[n]}) }
	res["seasons"] = seasons
	jsonOut(w, res)
}
