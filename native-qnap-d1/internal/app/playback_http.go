package app

import (
	"fmt"
	"net/http"
	"strings"
)

func (s *Server) resolve(source string) (map[string]any, error) {
	if !strings.HasPrefix(source, s.cfg.MediaBaseURL) { return nil, fmt.Errorf("outside MEDIA_BASE_URL") }
	dtsOnly, probed := probe(s.cfg, source)
	if !probed { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"probe_unavailable"},nil }
	if !dtsOnly { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"compatible_or_alternate_audio"},nil }
	if !s.cfg.EnableDTSFallback { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"dts_only_fallback_disabled"},nil }
	path,e:=ensureHLS(s.cfg,source)
	if e!=nil { return map[string]any{"mode":"direct","play_url":source,"source_url":source,"reason":"dts_only_ffmpeg_unavailable"},nil }
	return map[string]any{"mode":"hls_audio_fallback","play_url":path,"source_url":source,"reason":"dts_only"},nil
}

func (s *Server) playbackResolve(w http.ResponseWriter, r *http.Request) {
	x,e:=s.resolve(r.URL.Query().Get("source_url"))
	if e!=nil { jsonErr(w,http.StatusBadRequest,e.Error()); return }
	if p,ok:=x["play_url"].(string); ok&&strings.HasPrefix(p,"/hls/") { x["play_url"]="http://"+r.Host+p }
	jsonOut(w,x)
}

func (s *Server) playbackSmart(w http.ResponseWriter, r *http.Request) {
	x,e:=s.resolve(r.URL.Query().Get("source_url"))
	if e!=nil { jsonErr(w,http.StatusBadRequest,e.Error()); return }
	p:=fmt.Sprint(x["play_url"])
	if strings.HasPrefix(p,"/hls/") { p="http://"+r.Host+p }
	http.Redirect(w,r,p,http.StatusTemporaryRedirect)
}
