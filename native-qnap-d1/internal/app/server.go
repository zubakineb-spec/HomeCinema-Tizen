package app

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

type Server struct {
	cfg    Config
	store  *Store
	tmdb   *TMDB
	mux    *http.ServeMux
	scanMu sync.Mutex
	dlna   *dlnaRuntime
}

func NewServer(cfg Config) (*http.Server, error) {
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		return nil, err
	}
	st, err := NewStore(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, store: st, tmdb: NewTMDB(cfg.TMDBToken), mux: http.NewServeMux()}
	s.routes()
	s.startAutoLibrary()
	s.startDLNA()
	return &http.Server{Addr: cfg.Listen, Handler: s}, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.mux.ServeHTTP(w, r)
}

func jsonOut(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	jsonOut(w, map[string]any{"detail": msg})
}

func (s *Server) routes() {
	s.mux.HandleFunc("/api/health", s.health)
	s.mux.HandleFunc("/api/scan", s.scan)
	s.mux.HandleFunc("/api/catalog", s.catalog)
	s.mux.HandleFunc("/api/search", s.search)
	s.mux.HandleFunc("/api/continue", s.continueWatching)
	s.mux.HandleFunc("/api/movies/", s.movie)
	s.mux.HandleFunc("/api/shows/", s.show)
	s.mux.HandleFunc("/api/progress", s.progress)
	s.mux.HandleFunc("/api/playback/resolve", s.playbackResolve)
	s.mux.HandleFunc("/api/playback/smart", s.playbackSmart)
	s.mux.HandleFunc("/api/playback/tracks", s.playbackTracks)
	s.mux.HandleFunc("/api/playback/audio", s.playbackAudio)
	s.mux.HandleFunc("/api/playback/subtitle", s.playbackSubtitle)
	s.mux.HandleFunc("/api/dlna/status", s.dlnaStatusHTTP)
	s.mux.HandleFunc("/dlna/device.xml", s.dlnaDevice)
	s.mux.HandleFunc("/dlna/ContentDirectory.xml", s.dlnaCDSCPD)
	s.mux.HandleFunc("/dlna/ConnectionManager.xml", s.dlnaCMSCPD)
	s.mux.HandleFunc("/dlna/control/content", s.dlnaCDControl)
	s.mux.HandleFunc("/dlna/control/connection", s.dlnaCMControl)
	hls := filepath.Join(s.cfg.DataDir, "hls")
	_ = os.MkdirAll(hls, 0755)
	s.mux.Handle("/hls/", http.StripPrefix("/hls/", http.FileServer(http.Dir(hls))))
	s.mux.Handle("/media/", s.mediaHTTPHandler())
	s.mux.Handle("/", http.FileServer(http.Dir(s.cfg.WebRoot)))
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	dlna := s.dlna.status(s.cfg)
	jsonOut(w, map[string]any{
		"status":                        "ok",
		"version":                       Version,
		"runtime":                       "qnap-d1-native-armv7",
		"media_base_url":                s.cfg.MediaBaseURL,
		"media_root":                    s.cfg.MediaRoot,
		"tmdb":                          s.tmdb.enabled(),
		"target_nas":                    "QNAP D1 ARMv7 / QTS 4.3.6",
		"target_tv":                     "Samsung UE49NU7500U",
		"ffmpeg":                        tool("ffmpeg"),
		"ffprobe":                       tool("ffprobe"),
		"dts_fallback_enabled":          s.cfg.EnableDTSFallback,
		"auto_library":                  s.cfg.AutoLibrary,
		"auto_library_interval_seconds": int(s.cfg.AutoLibraryInterval.Seconds()),
		"dlna_enabled":                  s.cfg.DLNAEnabled,
		"dlna_name":                     s.cfg.DLNAName,
		"dlna_ssdp_listening":           dlna["ssdp_listening"],
		"dlna_location":                 dlna["location"],
	})
}
