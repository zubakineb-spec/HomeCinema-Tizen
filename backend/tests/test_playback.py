from app.playback import analyze_probe


def test_dts_only_requires_fallback():
    info = analyze_probe({"streams": [
        {"index": 0, "codec_type": "video", "codec_name": "hevc"},
        {"index": 1, "codec_type": "audio", "codec_name": "dca", "channels": 6},
    ], "format": {"duration": "7200.5"}})
    assert info["dts_only"] is True
    assert info["dts_indexes"] == [1]
    assert info["duration_seconds"] == 7200.5


def test_dts_with_aac_can_direct_play():
    info = analyze_probe({"streams": [
        {"index": 0, "codec_type": "video", "codec_name": "h264"},
        {"index": 1, "codec_type": "audio", "codec_name": "dca"},
        {"index": 2, "codec_type": "audio", "codec_name": "aac"},
    ]})
    assert info["dts_only"] is False
    assert info["supported_audio_indexes"] == [2]
    assert info["dts_indexes"] == [1]


def test_ac3_direct_play():
    info = analyze_probe({"streams": [
        {"index": 0, "codec_type": "video", "codec_name": "hevc"},
        {"index": 1, "codec_type": "audio", "codec_name": "ac3"},
    ]})
    assert info["dts_only"] is False
    assert info["supported_audio_indexes"] == [1]


def test_resolver_rejects_source_outside_media_base(tmp_path):
    from app.playback import PlaybackResolver
    r = PlaybackResolver(tmp_path, allowed_base_url="http://192.168.0.101/")
    assert r.source_allowed("http://192.168.0.101/Films/A.mkv") is True
    assert r.source_allowed("http://example.com/A.mkv") is False
    try:
        r.resolve("http://example.com/A.mkv", "http://localhost:8096/hls")
        assert False, "expected ValueError"
    except ValueError:
        pass
