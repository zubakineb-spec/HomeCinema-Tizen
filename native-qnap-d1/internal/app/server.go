package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type Server struct {
	cfg   Config
	store *Store
	tmdb  *TMDB
	mux   *http.ServeMux
}

func NewServer(cfg Config) (*http.Server, error) {
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		return nil, err
	}
	st, err := NewStore(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, store: st, tmdb: NewTMDB(cfg.TMDBToken), mux: http.NewServeMux()}
	s.routes()
	return &http.Server{Addr: cfg.Listen, Handler: s}, nil
}
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	if r.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	s.mux.ServeHTTP(w, r)
}
func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}
func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	jsonOut(w, map[string]any{"detail": msg})
}

func (s *Server) routes() {
	s.mux.HandleFunc("/api/health", s.health)
	s.mux.HandleFunc("/api/scan", s.scan)
	s.mux.HandleFunc("/api/catalog", s.catalog)
	s.mux.HandleFunc("/api/search", s.search)
	s.mux.HandleFunc("/api/continue", s.continueWatching)
	s.mux.HandleFunc("/api/movies/", s.movie)
	s.mux.HandleFunc("/api/shows/", s.show)
	s.mux.HandleFunc("/api/progress", s.progress)
	s.mux.HandleFunc("/api/playback/resolve", s.playbackResolve)
	s.mux.HandleFunc("/api/playback/smart", s.playbackSmart)
	hls := filepath.Join(s.cfg.DataDir, "hls")
	_ = os.MkdirAll(hls, 0755)
	s.mux.Handle("/hls/", http.StripPrefix("/hls/", http.FileServer(http.Dir(hls))))
	s.mux.Handle("/media/", http.StripPrefix("/media/", http.FileServer(http.Dir(s.cfg.MediaRoot))))
	s.mux.Handle("/", http.FileServer(http.Dir(s.cfg.WebRoot)))
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	jsonOut(w, map[string]any{"status": "ok", "version": Version, "runtime": "qnap-d1-native-armv7", "media_base_url": s.cfg.MediaBaseURL, "media_root": s.cfg.MediaRoot, "tmdb": s.tmdb.enabled(), "target_nas": "QNAP D1 ARMv7 / QTS 4.3.6", "target_tv": "Samsung UE49NU7500U", "ffmpeg": tool("ffmpeg"), "ffprobe": tool("ffprobe"), "dts_fallback_enabled": s.cfg.EnableDTSFallback})
}
func (s *Server) scan(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonErr(w, 405, "POST required")
		return
	}
	m, sh, ep, err := ScanLocal(s.cfg)
	if err != nil {
		jsonErr(w, 500, err.Error())
		return
	}
	if err = s.store.ReplaceScan(m, sh, ep); err != nil {
		jsonErr(w, 500, err.Error())
		return
	}
	matched := map[string]int{"movies_matched": 0, "shows_matched": 0, "episodes_matched": 0}
	if s.tmdb.enabled() {
		matched = s.enrich()
	}
	episodeCount, extraCount := 0, 0
	for _, item := range ep {
		if isExtra(item) { extraCount++ } else { episodeCount++ }
	}
	jsonOut(w, map[string]any{"source": s.cfg.MediaRoot, "video_files": len(m) + len(ep), "movies": len(m), "shows": len(sh), "episodes": episodeCount, "extras": extraCount, "ignored": 0, "tmdb_enabled": s.tmdb.enabled(), "movies_matched": matched["movies_matched"], "shows_matched": matched["shows_matched"], "episodes_matched": matched["episodes_matched"]})
}
func (s *Server) enrich() map[string]int {
	st := s.store.Snapshot()
	out := map[string]int{"movies_matched": 0, "shows_matched": 0, "episodes_matched": 0}
	for i := range st.Movies {
		if st.Movies[i].MetadataStatus == "matched" {
			continue
		}
		d, e := s.tmdb.Movie(st.Movies[i].Title, st.Movies[i].Year)
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
				if st.Episodes[j].ShowID != st.Shows[i].ID || st.Episodes[j].MetadataStatus == "matched" || st.Episodes[j].MetadataStatus == "local" || isExtra(st.Episodes[j]) {
					continue
				}
				d, e := s.tmdb.Episode(st.Shows[i].TMDBID, st.Episodes[j].Season, st.Episodes[j].Episode)
				if e == nil {
					if d.Name != "" {
						st.Episodes[j].Title = d.Name
					}
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
	if e != nil { jsonErr(w, 404, "Movie not found"); return }
	for _, m := range s.store.Snapshot().Movies { if m.ID == id { jsonOut(w, m); return } }
	jsonErr(w, 404, "Movie not found")
}
func (s *Server) show(w http.ResponseWriter, r *http.Request) {
	id, e := idTail(r.URL.Path, "/api/shows/")
	if e != nil { jsonErr(w, 404, "Show not found"); return }
	st := s.store.Snapshot()
	var found *Show
	for i := range st.Shows { if st.Shows[i].ID == id { found = &st.Shows[i]; break } }
	if found == nil { jsonErr(w, 404, "Show not found"); return }
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
	res["seasons"] = seasons; jsonOut(w, res)
}
func originalSource(v string) string {
	if u, err := http.NewRequest("GET", v, nil); err == nil && strings.HasSuffix(u.URL.Path, "/api/playback/smart") { if x := u.URL.Query().Get("source_url"); x != "" { return x } }
	return v
}
func (s *Server) progress(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" { jsonOut(w, s.store.GetProgress(originalSource(r.URL.Query().Get("source_url")))); return }
	if r.Method == "POST" {
		var p Progress; if json.NewDecoder(r.Body).Decode(&p) != nil { jsonErr(w, 400, "invalid JSON"); return }
		p.SourceURL = originalSource(p.SourceURL); if err := s.store.SetProgress(p); err != nil { jsonErr(w, 500, err.Error()); return }; jsonOut(w, map[string]bool{"ok": true}); return
	}
	jsonErr(w, 405, "GET/POST required")
}
func (s *Server) continueWatching(w http.ResponseWriter, r *http.Request) {
	st := s.store.Snapshot(); type item map[string]any; items := []item{}
	for _, p := range st.Progress {
		if p.Completed != 0 || p.PositionMS <= 0 || p.DurationMS <= 0 || p.PositionMS >= p.DurationMS { continue }
		for _, m := range st.Movies { if m.SourceURL == p.SourceURL { items = append(items, item{"media_type":"movie","id":m.ID,"title":m.Title,"parent_title":nil,"source_url":m.SourceURL,"image_url":m.PosterURL,"backdrop_url":m.BackdropURL,"position_ms":p.PositionMS,"duration_ms":p.DurationMS,"updated_at":p.UpdatedAt,"progress_percent":float64(p.PositionMS)*100/float64(p.DurationMS)}) } }
		for _, e := range st.Episodes {
			if e.SourceURL == p.SourceURL {
				parent, back, poster := "", "", ""; for _, sh := range st.Shows { if sh.ID == e.ShowID { parent=sh.Title; back=sh.BackdropURL; poster=sh.PosterURL } }
				img := e.StillURL; if img=="" { img=back }; if img=="" { img=poster }
				mediaType := "episode"; if isExtra(e) { mediaType = "extra" }
				x := item{"media_type":mediaType,"id":e.ID,"title":e.Title,"parent_title":parent,"source_url":e.SourceURL,"image_url":img,"backdrop_url":back,"position_ms":p.PositionMS,"duration_ms":p.DurationMS,"updated_at":p.UpdatedAt,"show_id":e.ShowID,"progress_percent":float64(p.PositionMS)*100/float64(p.DurationMS)}
				if !isExtra(e) { x["season"] = e.Season; x["episode"] = e.Episode }
				items = append(items, x)
			}
		}
	}
	sort.Slice(items, func(i,j int) bool { return fmt.Sprint(items[i]["updated_at"]) > fmt.Sprint(items[j]["updated_at"]) }); if len(items)>20 { items=items[:20] }; jsonOut(w,map[string]any{"items":items})
}
func (s *Server) resolve(source string) (map[string]any, error) {
	if !strings.HasPrefix(source, s.cfg.MediaBaseURL) { return nil, fmt.Errorf("outside MEDIA_BASE_URL") }
	dtsOnly, probed := probe(s.cfg, source)
	if !probed { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"probe_unavailable"},nil }
	if !dtsOnly { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"compatible_or_alternate_audio"},nil }
	if !s.cfg.EnableDTSFallback { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"dts_only_fallback_disabled"},nil }
	path,e:=ensureHLS(s.cfg,source); if e!=nil { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"dts_only_ffmpeg_unavailable"},nil }
	return map[string]any{"mode":"hls_audio_fallback","play_url":path,"source_url":source,"reason":"dts_only"},nil
}
func (s *Server) playbackResolve(w http.ResponseWriter, r *http.Request) { x,e:=s.resolve(r.URL.Query().Get("source_url")); if e!=nil { jsonErr(w,400,e.Error()); return }; if p,ok:=x["play_url"].(string); ok&&strings.HasPrefix(p,"/hls/") { x["play_url"]="http://"+r.Host+p }; jsonOut(w,x) }
func (s *Server) playbackSmart(w http.ResponseWriter, r *http.Request) { x,e:=s.resolve(r.URL.Query().Get("source_url")); if e!=nil { jsonErr(w,400,e.Error()); return }; p:=fmt.Sprint(x["play_url"]); if strings.HasPrefix(p,"/hls/") { p="http://"+r.Host+p }; http.Redirect(w,r,p,http.StatusTemporaryRedirect) }
