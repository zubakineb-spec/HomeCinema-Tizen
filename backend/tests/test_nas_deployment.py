from pathlib import Path

from app.playback import PlaybackResolver
from app.scanner import _crawl_local_directory


def test_local_media_url_mapping(tmp_path: Path):
    media = tmp_path / "media"
    target = media / "Series" / "Show" / "Season 01" / "01.mkv"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"x")
    r = PlaybackResolver(tmp_path / "hls", allowed_base_url="http://192.168.0.101/", local_root=media)
    assert r.input_source("http://192.168.0.101/Series/Show/Season%2001/01.mkv") == str(target.resolve())


def test_local_scanner_builds_public_urls(tmp_path: Path):
    media = tmp_path / "media"
    target = media / "Films" / "Dune Part Two 2024.mkv"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"x")
    urls = _crawl_local_directory(media, "http://192.168.0.101/")
    assert "http://192.168.0.101/Films/Dune%20Part%20Two%202024.mkv" in urls


def test_mapping_cannot_escape_local_root(tmp_path: Path):
    media = tmp_path / "media"
    media.mkdir()
    r = PlaybackResolver(tmp_path / "hls", allowed_base_url="http://192.168.0.101/", local_root=media)
    try:
        r.input_source("http://192.168.0.101/../secret.mkv")
    except ValueError as exc:
        assert str(exc) == "source_not_allowed"
    else:
        raise AssertionError("path traversal must be rejected")
