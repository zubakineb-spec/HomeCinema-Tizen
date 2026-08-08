from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SAMSUNG_2018_AUDIO = {
    "aac", "ac3", "eac3", "mp3", "mp2", "opus", "vorbis",
    "pcm_s16le", "pcm_s24le", "pcm_s32le", "wmav2", "wmapro",
}
DTS_CODECS = {"dca", "dts", "dts_hd", "dts-hd"}


def _codec_name(stream: dict[str, Any]) -> str:
    return str(stream.get("codec_name") or "").strip().lower()


def analyze_probe(data: dict[str, Any]) -> dict[str, Any]:
    streams = list(data.get("streams") or [])
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    video = [s for s in streams if s.get("codec_type") == "video"]
    audio_codecs = [_codec_name(s) for s in audio if _codec_name(s)]
    video_codecs = [_codec_name(s) for s in video if _codec_name(s)]
    supported_audio_indexes = [
        int(s.get("index")) for s in audio
        if _codec_name(s) in SAMSUNG_2018_AUDIO and s.get("index") is not None
    ]
    dts_indexes = [
        int(s.get("index")) for s in audio
        if _codec_name(s) in DTS_CODECS and s.get("index") is not None
    ]
    dts_only = bool(audio) and not supported_audio_indexes and bool(dts_indexes)
    duration = 0.0
    try:
        duration = float((data.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        pass
    return {
        "audio_codecs": audio_codecs,
        "video_codecs": video_codecs,
        "supported_audio_indexes": supported_audio_indexes,
        "dts_indexes": dts_indexes,
        "dts_only": dts_only,
        "duration_seconds": duration,
    }


@dataclass
class HlsJob:
    key: str
    directory: Path
    playlist: Path
    process: subprocess.Popen | None = None
    log_path: Path | None = None


class PlaybackResolver:
    def __init__(self, cache_dir: Path, ffmpeg_path: str = "ffmpeg", ffprobe_path: str = "ffprobe", allowed_base_url: str = ""):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ffmpeg_path = ffmpeg_path
        self.ffprobe_path = ffprobe_path
        self.allowed_base_url = allowed_base_url.rstrip("/") + "/" if allowed_base_url else ""
        self._jobs: dict[str, HlsJob] = {}
        self._lock = threading.Lock()

    @property
    def ffmpeg_available(self) -> bool:
        return bool(shutil.which(self.ffmpeg_path) or Path(self.ffmpeg_path).exists())

    @property
    def ffprobe_available(self) -> bool:
        return bool(shutil.which(self.ffprobe_path) or Path(self.ffprobe_path).exists())

    def source_allowed(self, source_url: str) -> bool:
        return bool(source_url) and (not self.allowed_base_url or source_url.startswith(self.allowed_base_url))

    def probe(self, source_url: str, timeout: int = 15) -> dict[str, Any]:
        if not self.source_allowed(source_url):
            return {"available": False, "reason": "source_not_allowed"}
        if not self.ffprobe_available:
            return {"available": False, "reason": "ffprobe_not_found"}
        cmd = [
            self.ffprobe_path, "-v", "error",
            "-show_entries", "stream=index,codec_type,codec_name,channels:format=duration",
            "-of", "json", source_url,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return {"available": False, "reason": "probe_failed", "detail": str(exc)}
        if result.returncode != 0:
            return {"available": False, "reason": "probe_failed", "detail": result.stderr[-800:]}
        try:
            raw = json.loads(result.stdout or "{}")
        except json.JSONDecodeError as exc:
            return {"available": False, "reason": "probe_invalid_json", "detail": str(exc)}
        return {"available": True, **analyze_probe(raw)}

    def resolve(self, source_url: str, public_hls_base: str) -> dict[str, Any]:
        if not self.source_allowed(source_url):
            raise ValueError("source_not_allowed")
        info = self.probe(source_url)
        if not info.get("available"):
            return {
                "mode": "direct", "play_url": source_url, "source_url": source_url,
                "reason": info.get("reason", "probe_unavailable"), "probe": info,
            }
        if not info.get("dts_only"):
            reason = "compatible_audio"
            if info.get("dts_indexes") and info.get("supported_audio_indexes"):
                reason = "alternate_compatible_audio"
            return {
                "mode": "direct", "play_url": source_url, "source_url": source_url,
                "reason": reason, "probe": info,
            }
        if not self.ffmpeg_available:
            return {
                "mode": "direct", "play_url": source_url, "source_url": source_url,
                "reason": "dts_only_ffmpeg_not_found", "probe": info,
            }
        job = self._ensure_hls(source_url)
        playlist_url = public_hls_base.rstrip("/") + "/" + job.key + "/index.m3u8"
        return {
            "mode": "hls_audio_fallback", "play_url": playlist_url, "source_url": source_url,
            "reason": "dts_only", "probe": info,
        }

    def _ensure_hls(self, source_url: str) -> HlsJob:
        key = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:24]
        directory = self.cache_dir / key
        playlist = directory / "index.m3u8"
        with self._lock:
            existing = self._jobs.get(key)
            if existing and existing.process and existing.process.poll() is None:
                return existing
            if playlist.exists() and any(directory.glob("seg*.ts")):
                return HlsJob(key=key, directory=directory, playlist=playlist)
            directory.mkdir(parents=True, exist_ok=True)
            for old in directory.glob("seg*.ts"):
                old.unlink(missing_ok=True)
            playlist.unlink(missing_ok=True)
            log_path = directory / "ffmpeg.log"
            log_file = log_path.open("ab", buffering=0)
            segment_pattern = str(directory / "seg%06d.ts")
            cmd = [
                self.ffmpeg_path, "-nostdin", "-hide_banner", "-loglevel", "warning", "-y",
                "-i", source_url,
                "-map", "0:v:0", "-map", "0:a:0",
                "-sn", "-dn",
                "-c:v", "copy",
                "-c:a", "aac", "-ac", "2", "-b:a", "256k",
                "-f", "hls", "-hls_time", "6", "-hls_list_size", "0",
                "-hls_playlist_type", "event",
                "-hls_flags", "independent_segments+temp_file",
                "-hls_segment_filename", segment_pattern,
                str(playlist),
            ]
            process = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=log_file)
            job = HlsJob(key=key, directory=directory, playlist=playlist, process=process, log_path=log_path)
            self._jobs[key] = job
        deadline = time.monotonic() + 3.0
        while time.monotonic() < deadline:
            if playlist.exists() and any(directory.glob("seg*.ts")):
                break
            if process.poll() is not None:
                break
            time.sleep(0.1)
        return job
