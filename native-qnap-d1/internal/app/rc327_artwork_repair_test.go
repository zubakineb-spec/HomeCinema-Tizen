package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRC327MatchedItemsWithoutArtworkNeedRepair(t *testing.T) {
	if !shouldRepairArtwork("matched", 101, "", "") {
		t.Fatal("matched movie without artwork must be repairable")
	}
	if shouldRepairArtwork("matched", 101, "https://image.tmdb.org/poster.jpg", "") {
		t.Fatal("existing poster must not trigger repair")
	}
	if shouldRepairArtwork("pending", 101, "", "") {
		t.Fatal("pending metadata remains owned by normal enrich")
	}
	if shouldRepairArtwork("matched", 0, "", "") {
		t.Fatal("repair requires a stable TMDB id")
	}
}

func TestRC327RepairUsesTMDBIDAndLanguageArtworkFallback(t *testing.T) {
	artworkRepairState.Lock()
	artworkRepairState.last = map[string]time.Time{}
	artworkRepairState.Unlock()

	hits := []string{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.URL.Path+"?"+r.URL.RawQuery)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/movie/101" && r.URL.Query().Get("language") == "ru-RU":
			_, _ = w.Write([]byte(`{"id":101,"title":"Фильм","poster_path":"","backdrop_path":""}`))
		case r.URL.Path == "/movie/101" && r.URL.Query().Get("language") == "en-US":
			_, _ = w.Write([]byte(`{"id":101,"title":"Movie","poster_path":"/movie-poster.jpg","backdrop_path":"/movie-backdrop.jpg"}`))
		case r.URL.Path == "/tv/202" && r.URL.Query().Get("language") == "ru-RU":
			_, _ = w.Write([]byte(`{"id":202,"name":"Сериал","poster_path":"","backdrop_path":""}`))
		case r.URL.Path == "/tv/202" && r.URL.Query().Get("language") == "en-US":
			_, _ = w.Write([]byte(`{"id":202,"name":"Show","poster_path":"/show-poster.jpg","backdrop_path":"/show-backdrop.jpg"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	st, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	initial := st.Snapshot()
	initial.Movies = []Movie{{ID: 1, Title: "Фильм", TMDBID: 101, MetadataStatus: "matched", RecognizedTitle: "Фильм"}}
	initial.Shows = []Show{{ID: 2, Title: "Сериал", TMDBID: 202, MetadataStatus: "matched", RecognizedTitle: "Сериал"}}
	if err := st.SetState(initial); err != nil {
		t.Fatal(err)
	}

	tmdb := NewTMDB("test-token")
	tmdb.baseURL = upstream.URL
	tmdb.client = upstream.Client()
	s := &Server{store: st, tmdb: tmdb}

	result := s.repairMissingArtwork()
	if result["movies_repaired"] != 1 || result["shows_repaired"] != 1 {
		t.Fatalf("unexpected repair result: %#v", result)
	}

	got := st.Snapshot()
	if len(got.Movies) != 1 || !strings.Contains(got.Movies[0].PosterURL, "/w500/movie-poster.jpg") {
		t.Fatalf("movie artwork not repaired: %+v", got.Movies)
	}
	if len(got.Shows) != 1 || !strings.Contains(got.Shows[0].BackdropURL, "/w1280/show-backdrop.jpg") {
		t.Fatalf("show artwork not repaired: %+v", got.Shows)
	}
	if len(hits) != 4 {
		t.Fatalf("expected ru-RU plus en-US artwork fallback for movie/show, hits=%v", hits)
	}
}
