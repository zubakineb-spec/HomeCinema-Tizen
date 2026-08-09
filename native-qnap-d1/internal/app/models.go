package app

import "encoding/json"

type Movie struct {
	ID             int     `json:"id"`
	SourceURL      string  `json:"source_url"`
	Title          string  `json:"title"`
	Year           int     `json:"year,omitempty"`
	TMDBID         int     `json:"tmdb_id,omitempty"`
	OriginalTitle  string  `json:"original_title,omitempty"`
	Overview       string  `json:"overview,omitempty"`
	PosterURL      string  `json:"poster_url,omitempty"`
	BackdropURL    string  `json:"backdrop_url,omitempty"`
	Rating         float64 `json:"rating,omitempty"`
	Runtime        int     `json:"runtime,omitempty"`
	Genres         string  `json:"genres,omitempty"`
	MetadataStatus string  `json:"metadata_status"`
	AddedAt        string  `json:"added_at"`
	UpdatedAt      string  `json:"updated_at"`
}

type Show struct {
	ID             int     `json:"id"`
	Title          string  `json:"title"`
	TMDBID         int     `json:"tmdb_id,omitempty"`
	OriginalTitle  string  `json:"original_title,omitempty"`
	Overview       string  `json:"overview,omitempty"`
	PosterURL      string  `json:"poster_url,omitempty"`
	BackdropURL    string  `json:"backdrop_url,omitempty"`
	Rating         float64 `json:"rating,omitempty"`
	Genres         string  `json:"genres,omitempty"`
	MetadataStatus string  `json:"metadata_status"`
	AddedAt        string  `json:"added_at"`
	UpdatedAt      string  `json:"updated_at"`
}

type Episode struct {
	ID             int    `json:"id"`
	ShowID         int    `json:"show_id"`
	SourceURL      string `json:"source_url"`
	Season         int    `json:"season"`
	Episode        int    `json:"episode"`
	Title          string `json:"title"`
	ContentType    string `json:"content_type,omitempty"`
	Overview       string `json:"overview,omitempty"`
	StillURL       string `json:"still_url,omitempty"`
	Runtime        int    `json:"runtime,omitempty"`
	AirDate        string `json:"air_date,omitempty"`
	MetadataStatus string `json:"metadata_status"`
	AddedAt        string `json:"added_at"`
	UpdatedAt      string `json:"updated_at"`
}

type Progress struct {
	SourceURL  string `json:"source_url"`
	PositionMS int64  `json:"position_ms"`
	DurationMS int64  `json:"duration_ms"`
	Completed  int    `json:"completed"`
	UpdatedAt  string `json:"updated_at"`
}

// UnmarshalJSON keeps the progress API backward-compatible with both the
// original numeric completed=0/1 contract and browser clients that naturally
// send completed=false/true.
func (p *Progress) UnmarshalJSON(data []byte) error {
	var raw struct {
		SourceURL  string          `json:"source_url"`
		PositionMS int64           `json:"position_ms"`
		DurationMS int64           `json:"duration_ms"`
		Completed  json.RawMessage `json:"completed"`
		UpdatedAt  string          `json:"updated_at"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	p.SourceURL = raw.SourceURL
	p.PositionMS = raw.PositionMS
	p.DurationMS = raw.DurationMS
	p.UpdatedAt = raw.UpdatedAt
	p.Completed = 0
	if len(raw.Completed) == 0 || string(raw.Completed) == "null" {
		return nil
	}
	var n int
	if err := json.Unmarshal(raw.Completed, &n); err == nil {
		if n != 0 { p.Completed = 1 }
		return nil
	}
	var b bool
	if err := json.Unmarshal(raw.Completed, &b); err != nil {
		return err
	}
	if b { p.Completed = 1 }
	return nil
}

type State struct {
	NextID   int                 `json:"next_id"`
	Movies   []Movie             `json:"movies"`
	Shows    []Show              `json:"shows"`
	Episodes []Episode           `json:"episodes"`
	Progress map[string]Progress `json:"progress"`
}
