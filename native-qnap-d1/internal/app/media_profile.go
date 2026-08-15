package app

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type profileProbeStream struct {
	CodecType     string `json:"codec_type"`
	CodecName     string `json:"codec_name"`
	Width         int    `json:"width"`
	Height        int    `json:"height"`
	ColorTransfer string `json:"color_transfer"`
	Channels      int    `json:"channels"`
}

type profileProbeFormat struct {
	FormatName string `json:"format_name"`
}

type profileProbeOut struct {
	Streams []profileProbeStream `json:"streams"`
	Format  profileProbeFormat   `json:"format"`
}

func extensionContainer(path string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(path)), ".")
	switch ext {
	case "mkv":
		return "matroska"
	case "mp4", "m4v":
		return "mp4"
	case "avi":
		return "avi"
	case "ts", "m2ts":
		return "mpegts"
	case "mov":
		return "mov"
	default:
		return ext
	}
}

func uniqueSorted(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func classifyCompatibility(p MediaProfile) (string, string) {
	if !p.Probed {
		return "direct_expected", "extension_only"
	}
	videoOK := map[string]bool{
		"h264": true, "hevc": true, "h265": true, "mpeg2video": true,
		"mpeg4": true, "vp8": true, "vp9": true,
	}
	if p.VideoCodec != "" && !videoOK[strings.ToLower(p.VideoCodec)] {
		return "review", "video_codec_" + strings.ToLower(p.VideoCodec)
	}
	hasSupported, hasDTS := false, false
	for _, codec := range p.AudioCodecs {
		codec = strings.ToLower(codec)
		if supportedAudio[codec] {
			hasSupported = true
		}
		if dtsAudio[codec] {
			hasDTS = true
		}
	}
	if hasDTS && !hasSupported {
		return "dts_only", "audio_transcode_recommended"
	}
	if len(p.AudioCodecs) > 0 && !hasSupported && !hasDTS {
		return "review", "audio_codec_" + p.AudioCodecs[0]
	}
	return "direct", "compatible"
}

func profileLocalFile(path string) MediaProfile {
	profile := MediaProfile{Container: extensionContainer(path)}
	if !tool("ffprobe") {
		profile.Compatibility, profile.Reason = classifyCompatibility(profile)
		return profile
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=format_name:stream=codec_type,codec_name,width,height,color_transfer,channels", "-of", "json", path)
	out, err := cmd.Output()
	if err != nil {
		profile.Compatibility, profile.Reason = classifyCompatibility(profile)
		return profile
	}
	var parsed profileProbeOut
	if json.Unmarshal(out, &parsed) != nil {
		profile.Compatibility, profile.Reason = classifyCompatibility(profile)
		return profile
	}
	profile.Probed = true
	if strings.TrimSpace(parsed.Format.FormatName) != "" {
		profile.Container = strings.Split(parsed.Format.FormatName, ",")[0]
	}
	var audio, subtitles []string
	for _, stream := range parsed.Streams {
		switch strings.ToLower(stream.CodecType) {
		case "video":
			if profile.VideoCodec == "" {
				profile.VideoCodec = strings.ToLower(stream.CodecName)
				profile.Width = stream.Width
				profile.Height = stream.Height
				transfer := strings.ToLower(stream.ColorTransfer)
				profile.HDR = transfer == "smpte2084" || transfer == "arib-std-b67"
			}
		case "audio":
			audio = append(audio, stream.CodecName)
		case "subtitle":
			subtitles = append(subtitles, stream.CodecName)
		}
	}
	profile.AudioCodecs = uniqueSorted(audio)
	profile.SubtitleCodecs = uniqueSorted(subtitles)
	profile.Compatibility, profile.Reason = classifyCompatibility(profile)
	return profile
}
