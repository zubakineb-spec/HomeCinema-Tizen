from dataclasses import dataclass
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    media_base_url: str = os.getenv("MEDIA_BASE_URL", "http://192.168.0.101/").rstrip("/") + "/"
    tmdb_bearer_token: str = os.getenv("TMDB_BEARER_TOKEN", "").strip()
    app_host: str = os.getenv("APP_HOST", "0.0.0.0")
    app_port: int = _int("APP_PORT", 8096)
    database_path: Path = Path(os.getenv("DATABASE_PATH", "./data/home_cinema.db"))
    image_cache_dir: Path = Path(os.getenv("IMAGE_CACHE_DIR", "./data/images"))
    scan_max_depth: int = _int("SCAN_MAX_DEPTH", 8)
    scan_request_timeout: int = _int("SCAN_REQUEST_TIMEOUT", 12)
    ffmpeg_path: str = os.getenv("FFMPEG_PATH", "ffmpeg").strip() or "ffmpeg"
    ffprobe_path: str = os.getenv("FFPROBE_PATH", "ffprobe").strip() or "ffprobe"
    hls_cache_dir: Path = Path(os.getenv("HLS_CACHE_DIR", "./data/hls"))


settings = Settings()
