package app

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (s *Server) refreshRecognizedTitles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonErr(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	if !s.tmdb.enabled() {
		jsonErr(w, http.StatusServiceUnavailable, "TMDB is not configured")
		return
	}

	s.scanMu.Lock()
	defer s.scanMu.Unlock()

	st := s.store.Snapshot()
	moviesUpdated, showsUpdated, failed := 0, 0, 0

	for i := range st.Movies {
		if st.Movies[i].TMDBID <= 0 { continue }
		var d details
		err := s.tmdb.get("/movie/"+strconv.Itoa(st.Movies[i].TMDBID), url.Values{"language": {"ru-RU"}}, &d)
		if err != nil || d.ID <= 0 { failed++; continue }
		title := strings.TrimSpace(d.Title)
		if title == "" { continue }
		if st.Movies[i].RecognizedTitle != title { moviesUpdated++ }
		st.Movies[i].RecognizedTitle = title
		if strings.TrimSpace(d.OriginalTitle) != "" { st.Movies[i].OriginalTitle = strings.TrimSpace(d.OriginalTitle) }
	}

	for i := range st.Shows {
		if st.Shows[i].TMDBID <= 0 { continue }
		var d details
		err := s.tmdb.get("/tv/"+strconv.Itoa(st.Shows[i].TMDBID), url.Values{"language": {"ru-RU"}}, &d)
		if err != nil || d.ID <= 0 { failed++; continue }
		title := strings.TrimSpace(d.Name)
		if title == "" { continue }
		if st.Shows[i].RecognizedTitle != title { showsUpdated++ }
		st.Shows[i].RecognizedTitle = title
		if strings.TrimSpace(d.OriginalName) != "" { st.Shows[i].OriginalTitle = strings.TrimSpace(d.OriginalName) }
	}

	if err := s.store.SetState(st); err != nil {
		jsonErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	jsonOut(w, map[string]any{
		"ok": true,
		"movies_updated": moviesUpdated,
		"shows_updated": showsUpdated,
		"failed": failed,
	})
}
