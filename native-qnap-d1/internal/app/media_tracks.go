package app

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type MediaTrack struct {
	StreamIndex int    `json:"stream_index"`
	Type        string `json:"type"`
	Codec       string `json:"codec"`
	Language    string `json:"language,omitempty"`
	Title       string `json:"title,omitempty"`
}

var ffmpegStreamLine = regexp.MustCompile(`Stream #\d+:(\d+)(?:\(([^)]+)\))?: (Audio|Subtitle): ([^,\s]+)`)

func inspectMediaTracks(cfg Config, source string) ([]MediaTrack, []MediaTrack, error) {
	if !tool("ffmpeg") {
		return nil, nil, fmt.Errorf("ffmpeg not found")
	}
	p, err := sourceLocal(cfg, originalSource(source))
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-i", p)
	out, _ := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return nil, nil, fmt.Errorf("ffmpeg track inspection timeout")
	}
	lines := strings.Split(string(out), "\n")
	audio := []MediaTrack{}
	subs := []MediaTrack{}
	for _, line := range lines {
		m := ffmpegStreamLine.FindStringSubmatch(line)
		if len(m) != 5 { continue }
		idx, err := strconv.Atoi(m[1])
		if err != nil { continue }
		t := MediaTrack{StreamIndex: idx, Type: strings.ToLower(m[3]), Codec: strings.ToLower(strings.TrimSpace(m[4])), Language: strings.TrimSpace(m[2])}
		if t.Type == "audio" { audio = append(audio, t) } else { subs = append(subs, t) }
	}
	return audio, subs, nil
}

func ffmpegHasEncoder(name string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-encoders").CombinedOutput()
	if err != nil && len(out) == 0 { return false }
	needle := " " + strings.TrimSpace(name) + " "
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, needle) { return true }
	}
	return false
}

func browserAudioTransports() []map[string]any {
	out := []map[string]any{{"id":"aac","content_type":"audio/aac","server":true}}
	if ffmpegHasEncoder("libmp3lame") {
		out = append([]map[string]any{{"id":"mp3","content_type":"audio/mpeg","server":true}}, out...)
	}
	return out
}

func (s *Server) playbackTracks(w http.ResponseWriter, r *http.Request) {
	source := originalSource(r.URL.Query().Get("source_url"))
	audio, subs, err := inspectMediaTracks(s.cfg, source)
	if err != nil { jsonErr(w, http.StatusBadRequest, err.Error()); return }
	jsonOut(w, map[string]any{
		"source_url": source,
		"audio": audio,
		"subtitles": subs,
		"ffmpeg": true,
		"browser_audio_transports": browserAudioTransports(),
	})
}

func parseStreamIndex(r *http.Request) (int, error) {
	idx, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("stream_index")))
	if err != nil || idx < 0 { return 0, fmt.Errorf("invalid stream_index") }
	return idx, nil
}

func audioSidecarArgs(path string, idx int, startMS int64, format string) ([]string, string, error) {
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error"}
	if startMS > 0 { args = append(args, "-ss", fmt.Sprintf("%.3f", float64(startMS)/1000.0)) }
	args = append(args, "-i", path, "-map", fmt.Sprintf("0:%d", idx), "-vn", "-sn", "-dn", "-ac", "2", "-ar", "48000")
	switch format {
	case "", "aac":
		args = append(args, "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "192k", "-f", "adts", "pipe:1")
		return args, "audio/aac", nil
	case "mp3":
		if !ffmpegHasEncoder("libmp3lame") { return nil, "", fmt.Errorf("libmp3lame encoder is not available") }
		args = append(args, "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1")
		return args, "audio/mpeg", nil
	default:
		return nil, "", fmt.Errorf("unsupported audio transport")
	}
}

func validADTSPrefix(b []byte) bool { return len(b)>=2 && b[0]==0xff && (b[1]&0xf6)==0xf0 }
func validMP3Prefix(b []byte) bool {
	if len(b)>=3 && string(b[:3])=="ID3" { return true }
	return len(b)>=2 && b[0]==0xff && (b[1]&0xe0)==0xe0
}
func validAudioPrefix(format string, b []byte) bool {
	if format=="mp3" { return validMP3Prefix(b) }
	return validADTSPrefix(b)
}

func (s *Server) playbackAudio(w http.ResponseWriter, r *http.Request) {
	if !tool("ffmpeg") { jsonErr(w, http.StatusServiceUnavailable, "ffmpeg not found"); return }
	source := originalSource(r.URL.Query().Get("source_url"))
	p, err := sourceLocal(s.cfg, source)
	if err != nil { jsonErr(w, http.StatusBadRequest, err.Error()); return }
	idx, err := parseStreamIndex(r)
	if err != nil { jsonErr(w, http.StatusBadRequest, err.Error()); return }
	startMS, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("start_ms")),10,64)
	if startMS<0 { startMS=0 }
	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format=="" { format="aac" }
	args, contentType, err := audioSidecarArgs(p,idx,startMS,format)
	if err != nil { jsonErr(w,http.StatusUnsupportedMediaType,err.Error()); return }

	ctx := r.Context()
	cmd := exec.CommandContext(ctx,"ffmpeg",args...)
	var stderr bytes.Buffer
	cmd.Stderr=&stderr
	stdout,err:=cmd.StdoutPipe()
	if err!=nil { jsonErr(w,http.StatusInternalServerError,"cannot open ffmpeg audio pipe"); return }
	if err=cmd.Start(); err!=nil { jsonErr(w,http.StatusUnsupportedMediaType,"cannot start ffmpeg audio conversion"); return }
	reader:=bufio.NewReaderSize(stdout,32*1024)
	prefix:=make([]byte,10)
	if _,err=io.ReadFull(reader,prefix); err!=nil || !validAudioPrefix(format,prefix) {
		_ = cmd.Process.Kill(); _ = cmd.Wait()
		msg:=strings.TrimSpace(stderr.String()); if msg=="" { msg="ffmpeg did not produce a valid "+format+" stream" }
		jsonErr(w,http.StatusUnsupportedMediaType,msg); return
	}
	w.Header().Set("Content-Type",contentType)
	w.Header().Set("Cache-Control","no-store")
	w.Header().Set("X-Content-Type-Options","nosniff")
	w.Header().Set("X-HomeCinema-Source",source)
	w.Header().Set("X-HomeCinema-Audio-Stream",strconv.Itoa(idx))
	w.Header().Set("X-HomeCinema-Audio-Transport",format)
	w.WriteHeader(http.StatusOK)
	_,_=w.Write(prefix)
	_,copyErr:=io.Copy(w,reader)
	waitErr:=cmd.Wait()
	if ctx.Err()==nil && copyErr==nil && waitErr!=nil {
		fmt.Printf("browser audio sidecar failed: source=%s stream=%d format=%s err=%v ffmpeg=%s\n",source,idx,format,waitErr,strings.TrimSpace(stderr.String()))
	}
}

func (s *Server) playbackSubtitle(w http.ResponseWriter, r *http.Request) {
	if !tool("ffmpeg") { jsonErr(w,http.StatusServiceUnavailable,"ffmpeg not found"); return }
	source:=originalSource(r.URL.Query().Get("source_url"))
	p,err:=sourceLocal(s.cfg,source)
	if err!=nil { jsonErr(w,http.StatusBadRequest,err.Error()); return }
	idx,err:=parseStreamIndex(r)
	if err!=nil { jsonErr(w,http.StatusBadRequest,err.Error()); return }
	cmd:=exec.CommandContext(r.Context(),"ffmpeg","-nostdin","-hide_banner","-loglevel","error","-i",p,"-map",fmt.Sprintf("0:%d",idx),"-f","webvtt","pipe:1")
	var stderr bytes.Buffer; cmd.Stderr=&stderr
	out,err:=cmd.Output()
	if err!=nil { jsonErr(w,http.StatusUnsupportedMediaType,"subtitle stream cannot be converted to WebVTT"); return }
	w.Header().Set("Content-Type","text/vtt; charset=utf-8"); w.Header().Set("Cache-Control","no-store"); _,_=w.Write(out)
}
