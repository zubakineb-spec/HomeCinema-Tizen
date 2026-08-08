from __future__ import annotations

from pathlib import Path
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .config import settings
from .db import Database
from .scanner import scan_library
from .tmdb import TmdbClient
from .playback import PlaybackResolver

ROOT = Path(__file__).resolve().parents[2]
TV_APP = ROOT / "tv-app"

db = Database(settings.database_path)
tmdb = TmdbClient(settings.tmdb_bearer_token, settings.scan_request_timeout)
playback = PlaybackResolver(settings.hls_cache_dir, settings.ffmpeg_path, settings.ffprobe_path, settings.media_base_url, settings.media_local_root)
app = FastAPI(title="Home Cinema", version=__version__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProgressIn(BaseModel):
    source_url: str
    position_ms: int = 0
    duration_ms: int = 0
    completed: bool = False


@app.get("/api/health")
def health():
    return {"status": "ok", "version": __version__, "media_base_url": settings.media_base_url, "tmdb": tmdb.enabled,
            "target_tv": "Samsung UE49NU7500U", "tizen": "4.0",
            "ffmpeg": playback.ffmpeg_available, "ffprobe": playback.ffprobe_available,
            "media_local_root": str(settings.media_local_root) if settings.media_local_root else None,
            "deployment": "nas" if settings.media_local_root else "http"}


@app.post("/api/scan")
async def scan():
    return await scan_library(db, tmdb, settings.media_base_url, settings.scan_max_depth, settings.scan_request_timeout, settings.media_local_root)


@app.get("/api/catalog")
def catalog():
    return db.catalog()


@app.get("/api/search")
def search(q: str = Query(default="", max_length=160)):
    return db.search(q)


@app.get("/api/continue")
def continue_watching(limit: int = Query(default=20, ge=1, le=100)):
    return {"items": db.continue_watching(limit)}


@app.get("/api/movies/{movie_id}")
def movie(movie_id: int):
    item = db.movie_by_id(movie_id)
    if not item:
        raise HTTPException(404, "Movie not found")
    return item


@app.get("/api/shows/{show_id}")
def show(show_id: int):
    item = db.show_by_id(show_id)
    if not item:
        raise HTTPException(404, "Show not found")
    return item


@app.get("/api/playback/resolve")
def resolve_playback(request: Request, source_url: str = Query(..., max_length=4096)):
    public_hls_base = str(request.base_url).rstrip("/") + "/hls"
    try:
        return playback.resolve(source_url, public_hls_base)
    except ValueError:
        raise HTTPException(400, "Media source is outside MEDIA_BASE_URL")


@app.get("/api/playback/smart")
def smart_playback(request: Request, source_url: str = Query(..., max_length=4096)):
    public_hls_base = str(request.base_url).rstrip("/") + "/hls"
    try:
        resolved = playback.resolve(source_url, public_hls_base)
    except ValueError:
        raise HTTPException(400, "Media source is outside MEDIA_BASE_URL")
    return RedirectResponse(resolved["play_url"], status_code=307)


def _original_source_url(value: str) -> str:
    from urllib.parse import parse_qs, urlparse
    try:
        parsed = urlparse(value)
        if parsed.path.endswith("/api/playback/smart"):
            source = parse_qs(parsed.query).get("source_url", [])
            if source:
                return source[0]
    except Exception:
        pass
    return value


@app.post("/api/progress")
def save_progress(data: ProgressIn):
    db.set_progress(_original_source_url(data.source_url), data.position_ms, data.duration_ms, data.completed)
    return {"ok": True}


@app.get("/api/progress")
def progress(source_url: str):
    return db.get_progress(_original_source_url(source_url))


app.mount("/css", StaticFiles(directory=TV_APP / "css"), name="css")
app.mount("/js", StaticFiles(directory=TV_APP / "js"), name="js")
settings.hls_cache_dir.mkdir(parents=True, exist_ok=True)
app.mount("/hls", StaticFiles(directory=settings.hls_cache_dir), name="hls")


@app.get("/")
def home():
    return FileResponse(TV_APP / "index.html")
