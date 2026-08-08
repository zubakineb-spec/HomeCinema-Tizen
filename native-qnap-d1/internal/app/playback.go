package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type probeStream struct {
	Index     int    `json:"index"`
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
}
type probeOut struct {
	Streams []probeStream `json:"streams"`
}

var supportedAudio = map[string]bool{"aac": true, "ac3": true, "eac3": true, "mp3": true, "mp2": true, "vorbis": true, "opus": true, "pcm_s16le": true}
var dtsAudio = map[string]bool{"dca": true, "dts": true, "dts_hd": true, "dts-hd": true}

func tool(name string) bool { _, e := exec.LookPath(name); return e == nil }
func sourceLocal(cfg Config, source string) (string, error) {
	if !strings.HasPrefix(source, cfg.MediaBaseURL) {
		return "", errors.New("source outside media base")
	}
	rel := strings.TrimPrefix(source, cfg.MediaBaseURL)
	u, e := url.PathUnescape(rel)
	if e != nil {
		return "", e
	}
	u = filepath.Clean(filepath.FromSlash(u))
	if u == ".." || strings.HasPrefix(u, ".."+string(os.PathSeparator)) {
		return "", errors.New("path traversal")
	}
	root, _ := filepath.Abs(cfg.MediaRoot)
	p, _ := filepath.Abs(filepath.Join(root, u))
	r, e := filepath.Rel(root, p)
	if e != nil || r == ".." || strings.HasPrefix(r, ".."+string(os.PathSeparator)) {
		return "", errors.New("outside media root")
	}
	return p, nil
}
func probe(cfg Config, source string) (bool, bool) {
	p, e := sourceLocal(cfg, source)
	if e != nil || !tool("ffprobe") {
		return false, false
	}
	cmd := exec.Command("ffprobe", "-v", "error", "-show_entries", "stream=index,codec_type,codec_name", "-of", "json", p)
	b, e := cmd.Output()
	if e != nil {
		return false, false
	}
	var x probeOut
	if json.Unmarshal(b, &x) != nil {
		return false, false
	}
	hasDTS, supported := false, false
	for _, s := range x.Streams {
		if s.CodecType != "audio" {
			continue
		}
		c := strings.ToLower(s.CodecName)
		if dtsAudio[c] {
			hasDTS = true
		}
		if supportedAudio[c] {
			supported = true
		}
	}
	return hasDTS && !supported, true
}
func ensureHLS(cfg Config, source string) (string, error) {
	p, e := sourceLocal(cfg, source)
	if e != nil {
		return "", e
	}
	if !tool("ffmpeg") {
		return "", errors.New("ffmpeg not found")
	}
	sum := sha256.Sum256([]byte(source))
	key := hex.EncodeToString(sum[:])[:24]
	dir := filepath.Join(cfg.DataDir, "hls", key)
	_ = os.MkdirAll(dir, 0755)
	pl := filepath.Join(dir, "index.m3u8")
	if _, e := os.Stat(pl); e == nil {
		return "/hls/" + key + "/index.m3u8", nil
	}
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "warning", "-y", "-i", p, "-map", "0:v:0", "-map", "0:a:0", "-sn", "-dn", "-c:v", "copy", "-c:a", "aac", "-ac", "2", "-b:a", "192k", "-f", "hls", "-hls_time", "8", "-hls_list_size", "0", "-hls_playlist_type", "event", "-hls_segment_filename", filepath.Join(dir, "seg%06d.ts"), pl}
	cmd := exec.Command("ffmpeg", args...)
	logf, _ := os.OpenFile(filepath.Join(dir, "ffmpeg.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if logf != nil {
		cmd.Stderr = logf
	}
	if e := cmd.Start(); e != nil {
		return "", e
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, e := os.Stat(pl); e == nil {
			return "/hls/" + key + "/index.m3u8", nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return "/hls/" + key + "/index.m3u8", nil
}
