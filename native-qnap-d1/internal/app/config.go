package app

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const Version = "0.3.2"

type Config struct {
	Listen            string
	MediaRoot         string
	MediaBaseURL      string
	DataDir           string
	WebRoot           string
	TMDBToken         string
	EnableDTSFallback bool
}

func getenv(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return d
}

func boolenv(k string, d bool) bool {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return d
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return d
	}
	return b
}

func LoadConfig() Config {
	exe, _ := os.Executable()
	base := filepath.Dir(exe)
	return Config{
		Listen:            getenv("HC_LISTEN", ":8096"),
		MediaRoot:         getenv("HC_MEDIA_ROOT", filepath.Join(base, "media")),
		MediaBaseURL:      strings.TrimRight(getenv("HC_MEDIA_BASE_URL", "http://192.168.0.101:8096/media/"), "/") + "/",
		DataDir:           getenv("HC_DATA_DIR", filepath.Join(base, "data")),
		WebRoot:           getenv("HC_WEB_ROOT", filepath.Join(base, "www")),
		TMDBToken:         strings.TrimSpace(os.Getenv("TMDB_BEARER_TOKEN")),
		EnableDTSFallback: boolenv("HC_ENABLE_DTS_FALLBACK", false),
	}
}
