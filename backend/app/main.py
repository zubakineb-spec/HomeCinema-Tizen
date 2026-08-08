from __future__ import annotations

from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .config import settings
from .db import Database
from .scanner import scan_library
from .tmdb import TmdbClient

ROOT = Path(__file__).resolve().parents[2]
TV_APP = ROOT / "tv-app"

db = Database(settings.database_path)
tmdb = TmdbClient(settings.tmdb_bearer_token, settings.scan_request_timeout)
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
    return {"status": "ok", "version": __version__, "media_base_url": settings.media_base_url, "tmdb": tmdb.enabled}


@app.post("/api/scan")
async def scan():
    return await scan_library(db, tmdb, settings.media_base_url, settings.scan_max_depth, settings.scan_request_timeout)


@app.get("/api/catalog")
def catalog():
    return db.catalog()


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


@app.post("/api/progress")
def save_progress(data: ProgressIn):
    db.set_progress(data.source_url, data.position_ms, data.duration_ms, data.completed)
    return {"ok": True}


@app.get("/api/progress")
def progress(source_url: str):
    return db.get_progress(source_url)


app.mount("/css", StaticFiles(directory=TV_APP / "css"), name="css")
app.mount("/js", StaticFiles(directory=TV_APP / "js"), name="js")


@app.get("/")
def home():
    return FileResponse(TV_APP / "index.html")
