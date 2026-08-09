package app

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const Version = "0.3.11"

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
	DLNAEnabled         bool
	DLNAName            string
	DLNAAdvertiseIP     string
	DLNAUUID            string
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

func durationSecondsEnv(k string, d int) time.Duration {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return time.Duration(d) * time.Second
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 30 {
		return time.Duration(d) * time.Second
	}
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
		DLNAEnabled:         boolenv("HC_DLNA_ENABLED", true),
		DLNAName:            getenv("HC_DLNA_NAME", "HOME CINEMA"),
		DLNAAdvertiseIP:     getenv("HC_DLNA_ADVERTISE_IP", "192.168.0.101"),
		DLNAUUID:            getenv("HC_DLNA_UUID", "6a0a34d4-27dd-4e02-9e07-7ef386393010"),
	}
}
