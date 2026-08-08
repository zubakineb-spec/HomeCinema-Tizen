package app

import "strings"

// localEpisodeOverride describes library items whose filename looks like an
// episode but whose real content type is known from the target media library.
func localEpisodeOverride(show string, season, episode int) (kind, title string, ok bool) {
	key := strings.ToLower(strings.TrimSpace(show))
	if key == "pasha" && season == 1 && episode == 9 {
		return "extra", "Фильм о фильме", true
	}
	return "", "", false
}

// preferredTMDBShowID pins only titles that are ambiguous enough for a plain
// TMDb text search to select the wrong series. After Life (2019) is TMDb 79410.
func preferredTMDBShowID(title string) int {
	if strings.EqualFold(strings.TrimSpace(title), "After Life") {
		return 79410
	}
	return 0
}

func episodeContentType(e Episode) string {
	if strings.TrimSpace(e.ContentType) == "" {
		return "episode"
	}
	return e.ContentType
}

func isExtra(e Episode) bool { return episodeContentType(e) == "extra" }
