package app

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

var videoExt = map[string]bool{".mkv": true, ".mp4": true, ".m4v": true, ".avi": true, ".mov": true, ".ts": true, ".m2ts": true, ".webm": true}
var epS = regexp.MustCompile(`(?i)(?:^|[ ._\-])s([0-9]{1,2})[ ._\-]*e([0-9]{1,3})(?:[ ._\-]|$)`)
var epX = regexp.MustCompile(`(?i)(?:^|[ ._\-])([0-9]{1,2})x([0-9]{1,3})(?:[ ._\-]|$)`)
var seasonDir = regexp.MustCompile(`(?i)^(?:season|сезон)[ ._\-]*([0-9]{1,2})$`)
var seasonS = regexp.MustCompile(`(?i)^s([0-9]{1,2})$`)
var numericEp = regexp.MustCompile(`(?i)^(?:e|ep|episode|серия)?[ ._\-]*([0-9]{1,3})(?:\D.*)?$`)
var yearRe = regexp.MustCompile(`(?:19|20)[0-9]{2}`)
var qualityRe = regexp.MustCompile(`(?i)\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10\+?|hdr|dv|dolby[ ._\-]?vision|bluray|blu[ ._\-]?ray|bdrip|webrip|web[ ._\-]?dl|dcprip|dcp|remux|amzn|netflix|nf|dsnp|hmax|atvp|h\.?26[45]|hevc|x26[45]|aac|ac3|eac3|dts(?:-hd)?|truehd|atmos|proper|repack|extended)\b.*$`)
var seasonSuffix = regexp.MustCompile(`(?i)(?:^|[ ._\-])(?:s[0-9]{1,2}|season[ ._\-]*[0-9]{1,2}|сезон[ ._\-]*[0-9]{1,2})\b.*$`)
var trailingReleaseTag = regexp.MustCompile(`(?i)(?:[ ._\-]+)(?:ma)(?:[ ._\-]*)$`)

type Parsed struct {
	Kind, Title, ShowTitle string
	Year, Season, Episode  int
}

func seasonNo(s string) int {
	for _, r := range []*regexp.Regexp{seasonDir, seasonS} {
		m := r.FindStringSubmatch(s)
		if len(m) > 1 {
			n, _ := strconv.Atoi(m[1])
			return n
		}
	}
	return -1
}
func cleanTitle(s string) string {
	if ext := strings.ToLower(filepath.Ext(s)); videoExt[ext] {
		s = strings.TrimSuffix(s, filepath.Ext(s))
	}
	s = qualityRe.ReplaceAllString(s, "")
	for trailingReleaseTag.MatchString(s) {
		s = trailingReleaseTag.ReplaceAllString(s, "")
	}
	s = strings.NewReplacer(".", " ", "_", " ", "–", " ", "—", " ").Replace(s)
	s = strings.Join(strings.Fields(s), " ")
	return strings.Trim(s, " ._-")
}
func cleanShowTitle(s string) string {
	s = seasonSuffix.ReplaceAllString(s, "")
	s = cleanTitle(s)
	s = strings.TrimSpace(yearRe.ReplaceAllString(s, ""))
	s = strings.Join(strings.Fields(s), " ")
	return strings.Trim(s, " ._-")
}
func showTitleFromEpisode(stem string, dirs []string, sdIdx int, re *regexp.Regexp) string {
	if loc := re.FindStringIndex(stem); len(loc) == 2 && loc[0] > 0 {
		if title := cleanShowTitle(stem[:loc[0]]); title != "" {
			return title
		}
	}
	if sdIdx > 0 {
		if title := cleanShowTitle(dirs[sdIdx-1]); title != "" {
			return title
		}
	}
	if len(dirs) > 0 {
		if title := cleanShowTitle(dirs[len(dirs)-1]); title != "" {
			return title
		}
	}
	return "Неизвестный сериал"
}
func episodeParsed(show string, season, episode int) Parsed {
	kind := "episode"
	title := "Серия " + strconv.Itoa(episode)
	if localKind, localTitle, ok := localEpisodeOverride(show, season, episode); ok {
		kind = localKind
		title = localTitle
	}
	return Parsed{Kind: kind, Title: title, ShowTitle: show, Season: season, Episode: episode}
}
func ParseMedia(rel string) (Parsed, bool) {
	ext := strings.ToLower(filepath.Ext(rel))
	if !videoExt[ext] {
		return Parsed{}, false
	}
	rel = filepath.ToSlash(rel)
	parts := strings.Split(rel, "/")
	file := parts[len(parts)-1]
	dirs := parts[:len(parts)-1]
	stem := strings.TrimSuffix(file, filepath.Ext(file))
	var sm []string
	var episodeRe *regexp.Regexp
	if x := epS.FindStringSubmatch(stem); len(x) > 0 {
		sm = x
		episodeRe = epS
	} else if x := epX.FindStringSubmatch(stem); len(x) > 0 {
		sm = x
		episodeRe = epX
	}
	sdIdx, sd := -1, -1
	for i := len(dirs) - 1; i >= 0; i-- {
		if n := seasonNo(dirs[i]); n >= 0 {
			sdIdx = i
			sd = n
			break
		}
	}
	if len(sm) > 2 {
		s, _ := strconv.Atoi(sm[1])
		e, _ := strconv.Atoi(sm[2])
		show := showTitleFromEpisode(stem, dirs, sdIdx, episodeRe)
		return episodeParsed(show, s, e), true
	}
	if sdIdx >= 0 {
		if m := numericEp.FindStringSubmatch(stem); len(m) > 1 {
			e, _ := strconv.Atoi(m[1])
			show := "Неизвестный сериал"
			if sdIdx > 0 {
				if title := cleanShowTitle(dirs[sdIdx-1]); title != "" {
					show = title
				}
			}
			return episodeParsed(show, sd, e), true
		}
	}
	title := cleanTitle(file)
	year := 0
	if y := yearRe.FindString(title); y != "" {
		year, _ = strconv.Atoi(y)
		title = strings.TrimSpace(yearRe.ReplaceAllString(title, ""))
	}
	return Parsed{Kind: "movie", Title: title, Year: year}, true
}
