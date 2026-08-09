package app

import (
	"bytes"
	"context"
	"fmt"
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
	out, _ := cmd.CombinedOutput() // ffmpeg exits non-zero when no output file is specified; probe text is still valid.
	if ctx.Err() != nil {
		return nil, nil, fmt.Errorf("ffmpeg track inspection timeout")
	}
	lines := strings.Split(string(out), "\n")
	audio := []MediaTrack{}
	subs := []MediaTrack{}
	for _, line := range lines {
		m := ffmpegStreamLine.FindStringSubmatch(line)
		if len(m) != 5 {
			continue
		}
		idx, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		t := MediaTrack{StreamIndex: idx, Type: strings.ToLower(m[3]), Codec: strings.ToLower(strings.TrimSpace(m[4])), Language: strings.TrimSpace(m[2])}
		if t.Type == "audio" {
			audio = append(audio, t)
		} else {
			subs = append(subs, t)
		}
	}
	return audio, subs, nil
}

func (s *Server) playbackTracks(w http.ResponseWriter, r *http.Request) {
	source := originalSource(r.URL.Query().Get("source_url"))
	audio, subs, err := inspectMediaTracks(s.cfg, source)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonOut(w, map[string]any{"source_url": source, "audio": audio, "subtitles": subs, "ffmpeg": true})
}

func parseStreamIndex(r *http.Request) (int, error) {
	idx, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("stream_index")))
	if err != nil || idx < 0 {
		return 0, fmt.Errorf("invalid stream_index")
	}
	return idx, nil
}

func (s *Server) playbackAudio(w http.ResponseWriter, r *http.Request) {
	if !tool("ffmpeg") {
		jsonErr(w, http.StatusServiceUnavailable, "ffmpeg not found")
		return
	}
	source := originalSource(r.URL.Query().Get("source_url"))
	p, err := sourceLocal(s.cfg, source)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	idx, err := parseStreamIndex(r)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	startMS, _ := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("start_ms")), 10, 64)
	if startMS < 0 {
		startMS = 0
	}

	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error"}
	if startMS > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", float64(startMS)/1000.0))
	}
	args = append(args,
		"-i", p,
		"-map", "0:v:0",
		"-map", fmt.Sprintf("0:%d", idx),
		"-sn", "-dn",
		"-c:v", "copy",
		"-c:a", "aac", "-ac", "2", "-b:a", "192k",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"-f", "mp4", "pipe:1",
	)
	ctx := r.Context()
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = w
	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-HomeCinema-Source", source)
	w.WriteHeader(http.StatusOK)
	if err := cmd.Run(); err != nil && ctx.Err() == nil {
		// Headers may already be committed. Log-level diagnostics remain available in the service log via stderr on caller failures.
		fmt.Printf("browser audio stream failed: source=%s stream=%d err=%v ffmpeg=%s\n", source, idx, err, strings.TrimSpace(stderr.String()))
	}
}

func (s *Server) playbackSubtitle(w http.ResponseWriter, r *http.Request) {
	if !tool("ffmpeg") {
		jsonErr(w, http.StatusServiceUnavailable, "ffmpeg not found")
		return
	}
	source := originalSource(r.URL.Query().Get("source_url"))
	p, err := sourceLocal(s.cfg, source)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	idx, err := parseStreamIndex(r)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, err.Error())
		return
	}
	cmd := exec.CommandContext(r.Context(), "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", p, "-map", fmt.Sprintf("0:%d", idx), "-f", "webvtt", "pipe:1")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		jsonErr(w, http.StatusUnsupportedMediaType, "subtitle stream cannot be converted to WebVTT")
		return
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(out)
}
