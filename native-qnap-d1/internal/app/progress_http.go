package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

func originalSource(v string) string {
	if u, err := http.NewRequest("GET", v, nil); err == nil && strings.HasSuffix(u.URL.Path, "/api/playback/smart") {
		if x := u.URL.Query().Get("source_url"); x != "" { return x }
	}
	return v
}

func (s *Server) progress(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		jsonOut(w, s.store.GetProgress(originalSource(r.URL.Query().Get("source_url"))))
		return
	}
	if r.Method == "POST" {
		var p Progress
		if json.NewDecoder(r.Body).Decode(&p) != nil { jsonErr(w, http.StatusBadRequest, "invalid JSON"); return }
		p.SourceURL = originalSource(p.SourceURL)
		if err := s.store.SetProgress(p); err != nil { jsonErr(w, http.StatusInternalServerError, err.Error()); return }
		jsonOut(w, map[string]bool{"ok": true})
		return
	}
	jsonErr(w, http.StatusMethodNotAllowed, "GET/POST required")
}

func preferredDisplayTitle(title, recognized string) string {
	if v := strings.TrimSpace(recognized); v != "" { return v }
	return title
}

func (s *Server) continueWatching(w http.ResponseWriter, r *http.Request) {
	st := s.store.Snapshot()
	type item map[string]any
	items := []item{}
	for _, p := range st.Progress {
		if p.Completed != 0 || p.PositionMS <= 0 || p.DurationMS <= 0 || p.PositionMS >= p.DurationMS { continue }
		for _, m := range st.Movies {
			if m.SourceURL == p.SourceURL {
				items = append(items, item{"media_type":"movie","id":m.ID,"title":preferredDisplayTitle(m.Title,m.RecognizedTitle),"parent_title":nil,"source_url":m.SourceURL,"image_url":m.PosterURL,"backdrop_url":m.BackdropURL,"position_ms":p.PositionMS,"duration_ms":p.DurationMS,"updated_at":p.UpdatedAt,"progress_percent":float64(p.PositionMS)*100/float64(p.DurationMS)})
			}
		}
		for _, e := range st.Episodes {
			if e.SourceURL != p.SourceURL { continue }
			parent, back, poster := "", "", ""
			for _, sh := range st.Shows { if sh.ID == e.ShowID { parent=preferredDisplayTitle(sh.Title,sh.RecognizedTitle); back=sh.BackdropURL; poster=sh.PosterURL } }
			img := e.StillURL; if img=="" { img=back }; if img=="" { img=poster }
			mediaType := "episode"; if isExtra(e) { mediaType = "extra" }
			x := item{"media_type":mediaType,"id":e.ID,"title":e.Title,"parent_title":parent,"source_url":e.SourceURL,"image_url":img,"backdrop_url":back,"position_ms":p.PositionMS,"duration_ms":p.DurationMS,"updated_at":p.UpdatedAt,"show_id":e.ShowID,"progress_percent":float64(p.PositionMS)*100/float64(p.DurationMS)}
			if !isExtra(e) { x["season"] = e.Season; x["episode"] = e.Episode }
			items = append(items, x)
		}
	}
	sort.Slice(items, func(i,j int) bool { return fmt.Sprint(items[i]["updated_at"]) > fmt.Sprint(items[j]["updated_at"]) })
	if len(items)>20 { items=items[:20] }
	jsonOut(w,map[string]any{"items":items})
}
