package app

import (
	"context"
	"encoding/json"
	"net/url"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const mediaProfileVersion = 315

type profileProbeStream struct {
	Index         int               `json:"index"`
	CodecType     string            `json:"codec_type"`
	CodecName     string            `json:"codec_name"`
	Width         int               `json:"width"`
	Height        int               `json:"height"`
	ColorTransfer string            `json:"color_transfer"`
	Channels      int               `json:"channels"`
	ChannelLayout string            `json:"channel_layout"`
	Tags          map[string]string `json:"tags"`
}

type profileProbeFormat struct {
	FormatName string `json:"format_name"`
	Duration   string `json:"duration"`
}

type profileProbeChapter struct {
	StartTime string            `json:"start_time"`
	EndTime   string            `json:"end_time"`
	Tags      map[string]string `json:"tags"`
}

type profileProbeOut struct {
	Streams  []profileProbeStream  `json:"streams"`
	Chapters []profileProbeChapter `json:"chapters"`
	Format   profileProbeFormat    `json:"format"`
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

func tagValue(tags map[string]string, names ...string) string {
	for _, name := range names {
		for key, value := range tags {
			if strings.EqualFold(strings.TrimSpace(key), name) {
				return strings.TrimSpace(value)
			}
		}
	}
	return ""
}

func parseProbeMS(value string) int64 {
	seconds, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || seconds <= 0 {
		return 0
	}
	return int64(seconds*1000 + 0.5)
}

func isIntroChapter(title string) bool {
	v := strings.ToLower(strings.TrimSpace(title))
	return strings.Contains(v, "intro") || strings.Contains(v, "opening") || strings.Contains(v, "застав") || strings.Contains(v, "опенинг")
}

func isCreditsChapter(title string) bool {
	v := strings.ToLower(strings.TrimSpace(title))
	if strings.Contains(v, "opening credit") {
		return false
	}
	return strings.Contains(v, "end credit") || strings.Contains(v, "closing credit") || strings.Contains(v, "credits") || strings.Contains(v, "титры") || strings.Contains(v, "ending") || strings.Contains(v, "outro")
}

func detectChapterMarkers(chapters []profileProbeChapter, durationMS int64) (int64, int64) {
	var introEnd int64
	var creditsStart int64
	for _, chapter := range chapters {
		title := tagValue(chapter.Tags, "title")
		start := parseProbeMS(chapter.StartTime)
		end := parseProbeMS(chapter.EndTime)
		if isIntroChapter(title) && end > 0 {
			if durationMS <= 0 || end <= durationMS/2 {
				if introEnd == 0 || end < introEnd {
					introEnd = end
				}
			}
		}
		if isCreditsChapter(title) && start > 0 {
			if durationMS <= 0 || start >= durationMS/2 {
				if start > creditsStart {
					creditsStart = start
				}
			}
		}
	}
	return introEnd, creditsStart
}

func detectAudioStudio(text string) string {
	v := strings.ToLower(strings.TrimSpace(text))
	if v == "" {
		return ""
	}
	studios := []struct {
		name    string
		aliases []string
	}{
		{"LostFilm", []string{"lostfilm", "lost film"}},
		{"NewStudio", []string{"newstudio", "new studio"}},
		{"Кураж-Бамбей", []string{"кураж-бамбей", "кураж бамбей", "kurazh-bambey"}},
		{"Кубик в Кубе", []string{"кубик в кубе", "кубик-в-кубе", "kubik v kube"}},
		{"HDRezka Studio", []string{"hdrezka studio", "hdrezka", "rezka studio"}},
		{"Jaskier", []string{"jaskier"}},
		{"AlexFilm", []string{"alexfilm", "alex film"}},
		{"BaibaKo", []string{"baibako", "baiba ko"}},
		{"ColdFilm", []string{"coldfilm", "cold film"}},
		{"IdeaFilm", []string{"ideafilm", "idea film"}},
		{"TVShows", []string{"tvshows", "tv shows"}},
		{"Red Head Sound", []string{"red head sound", "redheadsound"}},
		{"RuDub", []string{"rudub", "ru dub"}},
		{"AniLibria", []string{"anilibria", "ани libria"}},
	}
	for _, studio := range studios {
		for _, alias := range studio.aliases {
			if strings.Contains(v, alias) {
				return studio.name
			}
		}
	}
	return ""
}

func detectTranslationType(text string) string {
	v := strings.ToLower(" " + strings.TrimSpace(text) + " ")
	switch {
	case strings.Contains(v, "многоголос") || strings.Contains(v, " mvo ") || strings.Contains(v, "[mvo]") || strings.Contains(v, "(mvo)"):
		return "MVO"
	case strings.Contains(v, "двухголос") || strings.Contains(v, " dvo ") || strings.Contains(v, "[dvo]") || strings.Contains(v, "(dvo)"):
		return "DVO"
	case strings.Contains(v, "дублирован") || strings.Contains(v, "дубляж") || strings.Contains(v, " dub ") || strings.Contains(v, "[dub]") || strings.Contains(v, "(dub)"):
		return "DUB"
	case strings.Contains(v, "одноголос") || strings.Contains(v, "авторск") || strings.Contains(v, " avo ") || strings.Contains(v, "[avo]") || strings.Contains(v, "(avo)"):
		return "AVO"
	case strings.Contains(v, "закадров"):
		return "VO"
	case strings.Contains(v, "original") || strings.Contains(v, "оригинал"):
		return "Original"
	default:
		return ""
	}
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

func mediaLocalPath(cfg Config, source string) (string, bool) {
	base, err := url.Parse(strings.TrimRight(cfg.MediaBaseURL, "/") + "/")
	if err != nil {
		return "", false
	}
	src, err := url.Parse(strings.TrimSpace(source))
	if err != nil || src.Scheme != base.Scheme || src.Host != base.Host {
		return "", false
	}
	basePath := strings.TrimRight(base.Path, "/") + "/"
	if !strings.HasPrefix(src.Path, basePath) {
		return "", false
	}
	rel := strings.TrimPrefix(src.Path, basePath)
	rel = filepath.Clean(filepath.FromSlash(rel))
	if rel == "." || rel == "" || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", false
	}
	root := filepath.Clean(cfg.MediaRoot)
	full := filepath.Clean(filepath.Join(root, rel))
	check, err := filepath.Rel(root, full)
	if err != nil || check == ".." || strings.HasPrefix(check, ".."+string(filepath.Separator)) {
		return "", false
	}
	return full, true
}

func profileLocalFile(path string) MediaProfile {
	profile := MediaProfile{ProfileVersion: mediaProfileVersion, Container: extensionContainer(path)}
	if !tool("ffprobe") {
		profile.Compatibility, profile.Reason = classifyCompatibility(profile)
		return profile
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-show_entries", "format=format_name,duration:stream=index,codec_type,codec_name,width,height,color_transfer,channels,channel_layout:stream_tags=language,title,handler_name:chapter=start_time,end_time:chapter_tags=title", "-of", "json", path)
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
	durationMS := parseProbeMS(parsed.Format.Duration)
	profile.IntroEndMS, profile.CreditsStartMS = detectChapterMarkers(parsed.Chapters, durationMS)
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
			language := tagValue(stream.Tags, "language")
			title := tagValue(stream.Tags, "title")
			handler := tagValue(stream.Tags, "handler_name")
			attributionText := strings.TrimSpace(strings.Join([]string{title, handler}, " "))
			profile.AudioTracks = append(profile.AudioTracks, AudioTrackProfile{
				StreamIndex: stream.Index,
				Language:    language,
				Title:       title,
				HandlerName: handler,
				Codec:       strings.ToLower(stream.CodecName),
				Channels:    stream.Channels,
				Layout:      strings.ToLower(strings.TrimSpace(stream.ChannelLayout)),
				Studio:      detectAudioStudio(attributionText),
				Translation: detectTranslationType(attributionText),
			})
		case "subtitle":
			subtitles = append(subtitles, stream.CodecName)
		}
	}
	profile.AudioCodecs = uniqueSorted(audio)
	profile.SubtitleCodecs = uniqueSorted(subtitles)
	profile.Compatibility, profile.Reason = classifyCompatibility(profile)
	return profile
}
