package app

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const Version = "0.3.9"

type Config struct {
	Listen              string
	MediaRoot           string
	MediaBaseURL        string
	DataDir             string
	WebRoot             string
	TMDBToken           string
	EnableDTSFallback   bool
	AutoLibrary         bool
	AutoLibraryInterval time.Duration
}

func getenv(k, d string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" { return v }
	return d
}

func boolenv(k string, d bool) bool {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" { return d }
	b, err := strconv.ParseBool(v)
	if err != nil { return d }
	return b
}

func durationSecondsEnv(k string, d int) time.Duration {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" { return time.Duration(d) * time.Second }
	n, err := strconv.Atoi(v)
	if err != nil || n < 30 { return time.Duration(d) * time.Second }
	return time.Duration(n) * time.Second
}

func LoadConfig() Config {
	exe, _ := os.Executable()
	base := filepath.Dir(exe)
	return Config{
		Listen:              getenv("HC_LISTEN", ":8096"),
		MediaRoot:           getenv("HC_MEDIA_ROOT", filepath.Join(base, "media")),
		MediaBaseURL:        strings.TrimRight(getenv("HC_MEDIA_BASE_URL", "http://192.168.0.101:8096/media/"), "/") + "/",
		DataDir:             getenv("HC_DATA_DIR", filepath.Join(base, "data")),
		WebRoot:             getenv("HC_WEB_ROOT", filepath.Join(base, "www")),
		TMDBToken:           strings.TrimSpace(os.Getenv("TMDB_BEARER_TOKEN")),
		EnableDTSFallback:   boolenv("HC_ENABLE_DTS_FALLBACK", false),
		AutoLibrary:         boolenv("HC_AUTO_LIBRARY", true),
		AutoLibraryInterval: durationSecondsEnv("HC_AUTO_LIBRARY_INTERVAL_SECONDS", 120),
	}
}
