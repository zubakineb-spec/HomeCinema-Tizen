package app

import (
	"bufio"
	"bytes"
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const rc316ProfileVersion = 316

var (
	ffmpegDurationRE = regexp.MustCompile(`Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)`)
	ffmpegStreamRE   = regexp.MustCompile(`Stream #0:(\d+)(?:\(([^)]+)\))?(?:\[[^\]]+\])?:\s*(Video|Audio|Subtitle):\s*([^,\s]+)(.*)$`)
	ffmpegChapterRE  = regexp.MustCompile(`Chapter #0:\d+: start\s+([0-9.]+), end\s+([0-9.]+)`)
	ffmpegSizeRE     = regexp.MustCompile(`(?:^|,\s*)(\d{3,5})x(\d{3,5})(?:[\s,]|$)`)
	ffmpegChannelsRE = regexp.MustCompile(`(?:^|,\s*)(\d+) channels?(?:[\s,]|$)`)
	ffmpegMetaRE     = regexp.MustCompile(`^\s*([A-Za-z0-9_ -]+)\s*:\s*(.*?)\s*$`)
)

func parseFFmpegDurationMS(text string) int64 {
	m := ffmpegDurationRE.FindStringSubmatch(text)
	if len(m) != 4 {
		return 0
	}
	h, _ := strconv.ParseFloat(m[1], 64)
	min, _ := strconv.ParseFloat(m[2], 64)
	sec, _ := strconv.ParseFloat(m[3], 64)
	return int64((h*3600+min*60+sec)*1000 + 0.5)
}

func ffmpegLayout(rest string) (int, string) {
	v := strings.ToLower(rest)
	switch {
	case strings.Contains(v, "7.1"):
		return 8, "7.1"
	case strings.Contains(v, "5.1"):
		return 6, "5.1"
	case strings.Contains(v, "stereo"):
		return 2, "stereo"
	case strings.Contains(v, "mono"):
		return 1, "mono"
	}
	if m := ffmpegChannelsRE.FindStringSubmatch(rest); len(m) == 2 {
		n, _ := strconv.Atoi(m[1])
		return n, ""
	}
	return 0, ""
}

func parseFFmpegProfile(path string, raw []byte) MediaProfile {
	profile := MediaProfile{ProfileVersion: rc316ProfileVersion, Container: extensionContainer(path), Probed: true}
	durationMS := parseFFmpegDurationMS(string(raw))
	var chapters []profileProbeChapter
	var audioCodecs []string
	var subtitleCodecs []string
	var currentAudio = -1
	var currentChapter = -1

	scanner := bufio.NewScanner(bytes.NewReader(raw))
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if m := ffmpegChapterRE.FindStringSubmatch(line); len(m) == 3 {
			chapters = append(chapters, profileProbeChapter{StartTime: m[1], EndTime: m[2], Tags: map[string]string{}})
			currentChapter = len(chapters) - 1
			currentAudio = -1
			continue
		}
		if m := ffmpegStreamRE.FindStringSubmatch(strings.TrimSpace(line)); len(m) == 6 {
			idx, _ := strconv.Atoi(m[1])
			language := strings.TrimSpace(m[2])
			kind := strings.ToLower(strings.TrimSpace(m[3]))
			codec := strings.ToLower(strings.TrimSpace(m[4]))
			rest := m[5]
			currentChapter = -1
			currentAudio = -1
			switch kind {
			case "video":
				if profile.VideoCodec == "" {
					profile.VideoCodec = codec
					if sz := ffmpegSizeRE.FindStringSubmatch(rest); len(sz) == 3 {
						profile.Width, _ = strconv.Atoi(sz[1])
						profile.Height, _ = strconv.Atoi(sz[2])
					}
					lower := strings.ToLower(rest)
					profile.HDR = strings.Contains(lower, "smpte2084") || strings.Contains(lower, "arib-std-b67")
				}
			case "audio":
				channels, layout := ffmpegLayout(rest)
				profile.AudioTracks = append(profile.AudioTracks, AudioTrackProfile{
					StreamIndex: idx,
					Language:    language,
					Codec:       codec,
					Channels:    channels,
					Layout:      layout,
				})
				currentAudio = len(profile.AudioTracks) - 1
				audioCodecs = append(audioCodecs, codec)
			case "subtitle":
				subtitleCodecs = append(subtitleCodecs, codec)
			}
			continue
		}

		if m := ffmpegMetaRE.FindStringSubmatch(line); len(m) == 3 {
			key := strings.ToLower(strings.TrimSpace(m[1]))
			value := strings.TrimSpace(m[2])
			if value == "" {
				continue
			}
			if currentAudio >= 0 && currentAudio < len(profile.AudioTracks) {
				switch key {
				case "title":
					profile.AudioTracks[currentAudio].Title = value
				case "handler_name", "handler name":
					profile.AudioTracks[currentAudio].HandlerName = value
				case "language":
					if profile.AudioTracks[currentAudio].Language == "" {
						profile.AudioTracks[currentAudio].Language = value
					}
				}
			}
			if currentChapter >= 0 && currentChapter < len(chapters) && key == "title" {
				chapters[currentChapter].Tags["title"] = value
			}
		}
	}

	for i := range profile.AudioTracks {
		meta := &profile.AudioTracks[i]
		attr := strings.TrimSpace(strings.Join([]string{meta.Title, meta.HandlerName}, " "))
		meta.Studio = detectAudioStudio(attr)
		meta.Translation = detectTranslationType(attr)
	}
	profile.AudioCodecs = uniqueSorted(audioCodecs)
	profile.SubtitleCodecs = uniqueSorted(subtitleCodecs)
	profile.IntroEndMS, profile.CreditsStartMS = detectChapterMarkers(chapters, durationMS)
	profile.Compatibility, profile.Reason = classifyCompatibility(profile)
	return profile
}

func profileLocalFileRC316(path string) MediaProfile {
	if tool("ffprobe") {
		profile := profileLocalFile(path)
		profile.ProfileVersion = rc316ProfileVersion
		return profile
	}
	if !tool("ffmpeg") {
		profile := profileLocalFile(path)
		profile.ProfileVersion = rc316ProfileVersion
		return profile
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffmpeg", "-hide_banner", "-i", path, "-map", "0", "-c", "copy", "-t", "0", "-f", "null", "-")
	out, _ := cmd.CombinedOutput()
	if len(out) == 0 {
		profile := profileLocalFile(path)
		profile.ProfileVersion = rc316ProfileVersion
		return profile
	}
	return parseFFmpegProfile(path, out)
}
