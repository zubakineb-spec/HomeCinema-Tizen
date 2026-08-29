package app

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const Version = "0.3.18"

type Config struct {
	Listen            string
	MediaRoot         string
	MediaBaseURL      string
	DataDir           string
	WebRoot           string
	TMDBToken         string
	ImageCacheDir     string
	EnableDTSFallback bool
	AutoScanSeconds   int
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

func intenv(k string, d int) int {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return d
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return d
	}
	return n
}

func LoadConfig() Config {
	exe, _ := os.Executable()
	base := filepath.Dir(exe)
	dataDir := getenv("HC_DATA_DIR", filepath.Join(base, "data"))
	return Config{
		Listen:            getenv("HC_LISTEN", ":8096"),
		MediaRoot:         getenv("HC_MEDIA_ROOT", filepath.Join(base, "media")),
		MediaBaseURL:      strings.TrimRight(getenv("HC_MEDIA_BASE_URL", "http://192.168.0.101:8096/media/"), "/") + "/",
		DataDir:           dataDir,
		WebRoot:           getenv("HC_WEB_ROOT", filepath.Join(base, "www")),
		TMDBToken:         strings.TrimSpace(os.Getenv("TMDB_BEARER_TOKEN")),
		ImageCacheDir:     getenv("HC_IMAGE_CACHE_DIR", filepath.Join(dataDir, "image-cache")),
		EnableDTSFallback: boolenv("HC_ENABLE_DTS_FALLBACK", false),
		AutoScanSeconds:   intenv("HC_AUTO_SCAN_SECONDS", 60),
	}
}
