package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const tmdbAPIBaseURL = "https://api.themoviedb.org/3"

type TMDB struct {
	token   string
	client  *http.Client
	baseURL string
}

func NewTMDB(token string) *TMDB {
	return &TMDB{
		token:   strings.TrimSpace(token),
		client:  &http.Client{Timeout: 12 * time.Second},
		baseURL: tmdbAPIBaseURL,
	}
}

func (t *TMDB) enabled() bool { return t.token != "" }

func (t *TMDB) Probe() error {
	var out map[string]any
	return t.get("/configuration", nil, &out)
}

func (t *TMDB) get(path string, q url.Values, out any) error {
	if !t.enabled() {
		return fmt.Errorf("TMDB token is not configured")
	}
	base := strings.TrimRight(t.baseURL, "/")
	if base == "" {
		base = tmdbAPIBaseURL
	}
	u := base + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return fmt.Errorf("create TMDB request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+t.token)
	req.Header.Set("Accept", "application/json")
	client := t.client
	if client == nil {
		client = &http.Client{Timeout: 12 * time.Second}
	}
	r, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("TMDB request failed: %w", err)
	}
	defer r.Body.Close()

	body, readErr := io.ReadAll(io.LimitReader(r.Body, 8*1024*1024))
	if readErr != nil {
		return fmt.Errorf("read TMDB response: %w", readErr)
	}
	if r.StatusCode/100 != 2 {
		var apiErr struct {
			StatusCode    int    `json:"status_code"`
			StatusMessage string `json:"status_message"`
		}
		_ = json.Unmarshal(body, &apiErr)
		if strings.TrimSpace(apiErr.StatusMessage) != "" {
			return fmt.Errorf("TMDB %s: %s", r.Status, apiErr.StatusMessage)
		}
		return fmt.Errorf("TMDB %s", r.Status)
	}
	if out == nil || len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode TMDB response: %w", err)
	}
	return nil
}

func image(p, size string) string {
	if p == "" {
		return ""
	}
	return "https://image.tmdb.org/t/p/" + size + p
}

type searchResp struct {
	Results []struct {
		ID int `json:"id"`
	} `json:"results"`
}

type details struct {
	ID            int     `json:"id"`
	Title         string  `json:"title"`
	Name          string  `json:"name"`
	OriginalTitle string  `json:"original_title"`
	OriginalName  string  `json:"original_name"`
	Overview      string  `json:"overview"`
	PosterPath    string  `json:"poster_path"`
	BackdropPath  string  `json:"backdrop_path"`
	Vote          float64 `json:"vote_average"`
	Runtime       int     `json:"runtime"`
	Genres        []struct {
		Name string `json:"name"`
	} `json:"genres"`
	StillPath string `json:"still_path"`
	AirDate   string `json:"air_date"`
}

func names(g []struct {
	Name string `json:"name"`
}) string {
	a := []string{}
	for _, x := range g {
		if x.Name != "" {
			a = append(a, x.Name)
		}
	}
	return strings.Join(a, ", ")
}

func (t *TMDB) Movie(title string, year int) (details, error) {
	q := url.Values{"query": {title}, "language": {"ru-RU"}, "include_adult": {"false"}}
	if year > 0 {
		q.Set("year", strconv.Itoa(year))
	}
	var s searchResp
	if err := t.get("/search/movie", q, &s); err != nil {
		return details{}, err
	}
	if len(s.Results) == 0 {
		return details{}, fmt.Errorf("TMDB movie not found: %s", title)
	}
	var d details
	err := t.get("/movie/"+strconv.Itoa(s.Results[0].ID), url.Values{"language": {"ru-RU"}}, &d)
	return d, err
}

func (t *TMDB) Show(title string) (details, error) {
	q := url.Values{"query": {title}, "language": {"ru-RU"}, "include_adult": {"false"}}
	var s searchResp
	if err := t.get("/search/tv", q, &s); err != nil {
		return details{}, err
	}
	if len(s.Results) == 0 {
		return details{}, fmt.Errorf("TMDB show not found: %s", title)
	}
	var d details
	err := t.get("/tv/"+strconv.Itoa(s.Results[0].ID), url.Values{"language": {"ru-RU"}}, &d)
	return d, err
}

func (t *TMDB) Episode(show, season, ep int) (details, error) {
	var d details
	err := t.get(fmt.Sprintf("/tv/%d/season/%d/episode/%d", show, season, ep), url.Values{"language": {"ru-RU"}}, &d)
	return d, err
}
