package app

import "testing"

func TestRC316FFmpegProfileAudioAndCredits(t *testing.T) {
	raw := []byte(`Input #0, matroska,webm, from 'sample.mkv':
  Duration: 00:45:00.000, start: 0.000000, bitrate: 8000 kb/s
    Chapter #0:0: start 0.000000, end 80.000000
      Metadata:
        title           : Intro
    Chapter #0:1: start 2640.000000, end 2700.000000
      Metadata:
        title           : End Credits
  Stream #0:0: Video: h264, yuv420p, 1920x1080, 23.98 fps
  Stream #0:1(rus): Audio: ac3, 48000 Hz, 5.1(side), fltp, 640 kb/s
      Metadata:
        title           : LostFilm MVO
  Stream #0:2(eng): Audio: dts, 48000 Hz, 5.1(side), s16p
      Metadata:
        title           : Original
`)
	p := parseFFmpegProfile("sample.mkv", raw)
	if p.ProfileVersion != creditsMarkerProfileVersion {
		t.Fatalf("profile version=%d want %d", p.ProfileVersion, creditsMarkerProfileVersion)
	}
	if !p.Probed || p.VideoCodec != "h264" || p.Width != 1920 || p.Height != 1080 {
		t.Fatalf("video profile=%+v", p)
	}
	if len(p.AudioTracks) != 2 {
		t.Fatalf("audio tracks=%d", len(p.AudioTracks))
	}
	if p.AudioTracks[0].Language != "rus" || p.AudioTracks[0].Studio != "LostFilm" || p.AudioTracks[0].Translation != "MVO" {
		t.Fatalf("track0=%+v", p.AudioTracks[0])
	}
	if p.AudioTracks[0].Channels != 6 || p.AudioTracks[0].Layout != "5.1" {
		t.Fatalf("track0 channels=%+v", p.AudioTracks[0])
	}
	if p.CreditsStartMS != 2640000 {
		t.Fatalf("credits_start_ms=%d", p.CreditsStartMS)
	}
	if p.IntroEndMS != 80000 {
		t.Fatalf("intro_end_ms=%d", p.IntroEndMS)
	}
}
