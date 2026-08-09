package app

import (
	"net/url"
	"strconv"
	"strings"
)

func (t *TMDB) movieOverviewFallback(d details) details {
	if d.ID <= 0 || strings.TrimSpace(d.Overview) != "" { return d }
	var en details
	if err := t.get("/movie/"+strconv.Itoa(d.ID), url.Values{"language": {"en-US"}}, &en); err == nil && strings.TrimSpace(en.Overview) != "" {
		d.Overview = en.Overview
	}
	return d
}

func (t *TMDB) showOverviewFallback(d details) details {
	if d.ID <= 0 || strings.TrimSpace(d.Overview) != "" { return d }
	var en details
	if err := t.get("/tv/"+strconv.Itoa(d.ID), url.Values{"language": {"en-US"}}, &en); err == nil && strings.TrimSpace(en.Overview) != "" {
		d.Overview = en.Overview
	}
	return d
}

func (t *TMDB) episodeOverviewFallback(showID, season, episode int, d details) details {
	if showID <= 0 || strings.TrimSpace(d.Overview) != "" { return d }
	var en details
	path := "/tv/"+strconv.Itoa(showID)+"/season/"+strconv.Itoa(season)+"/episode/"+strconv.Itoa(episode)
	if err := t.get(path, url.Values{"language": {"en-US"}}, &en); err == nil && strings.TrimSpace(en.Overview) != "" {
		d.Overview = en.Overview
	}
	return d
}
