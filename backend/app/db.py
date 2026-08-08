from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    year INTEGER,
    tmdb_id INTEGER,
    original_title TEXT,
    overview TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    rating REAL,
    runtime INTEGER,
    genres TEXT,
    metadata_status TEXT NOT NULL DEFAULT 'pending',
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL UNIQUE,
    tmdb_id INTEGER,
    original_title TEXT,
    overview TEXT,
    poster_url TEXT,
    backdrop_url TEXT,
    rating REAL,
    genres TEXT,
    metadata_status TEXT NOT NULL DEFAULT 'pending',
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER NOT NULL,
    source_url TEXT NOT NULL UNIQUE,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    title TEXT,
    overview TEXT,
    still_url TEXT,
    runtime INTEGER,
    air_date TEXT,
    metadata_status TEXT NOT NULL DEFAULT 'pending',
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(show_id) REFERENCES shows(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_episode_show_season ON episodes(show_id, season, episode);
CREATE TABLE IF NOT EXISTS progress (
    source_url TEXT PRIMARY KEY,
    position_ms INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS match_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_type TEXT NOT NULL,
    source_key TEXT NOT NULL,
    parsed_title TEXT NOT NULL,
    parsed_year INTEGER,
    reason TEXT NOT NULL,
    candidates_json TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


class Database:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.init()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def init(self) -> None:
        with self.connect() as conn:
            conn.executescript(SCHEMA)

    def upsert_movie(self, source_url: str, title: str, year: int | None) -> int:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO movies(source_url,title,year) VALUES(?,?,?)
                ON CONFLICT(source_url) DO UPDATE SET title=excluded.title,year=excluded.year,updated_at=CURRENT_TIMESTAMP""",
                (source_url, title, year),
            )
            return int(conn.execute("SELECT id FROM movies WHERE source_url=?", (source_url,)).fetchone()[0])

    def upsert_show(self, title: str) -> int:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO shows(title) VALUES(?) ON CONFLICT(title) DO UPDATE SET updated_at=CURRENT_TIMESTAMP""",
                (title,),
            )
            return int(conn.execute("SELECT id FROM shows WHERE title=?", (title,)).fetchone()[0])

    def upsert_episode(self, show_id: int, source_url: str, season: int, episode: int, title: str) -> int:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO episodes(show_id,source_url,season,episode,title) VALUES(?,?,?,?,?)
                ON CONFLICT(source_url) DO UPDATE SET show_id=excluded.show_id,season=excluded.season,
                episode=excluded.episode,title=excluded.title,updated_at=CURRENT_TIMESTAMP""",
                (show_id, source_url, season, episode, title),
            )
            return int(conn.execute("SELECT id FROM episodes WHERE source_url=?", (source_url,)).fetchone()[0])

    def update_movie_metadata(self, movie_id: int, data: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """UPDATE movies SET tmdb_id=?,original_title=?,overview=?,poster_url=?,backdrop_url=?,rating=?,runtime=?,genres=?,metadata_status='matched',updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                (data.get("tmdb_id"), data.get("original_title"), data.get("overview"), data.get("poster_url"), data.get("backdrop_url"), data.get("rating"), data.get("runtime"), data.get("genres"), movie_id),
            )

    def update_show_metadata(self, show_id: int, data: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """UPDATE shows SET tmdb_id=?,original_title=?,overview=?,poster_url=?,backdrop_url=?,rating=?,genres=?,metadata_status='matched',updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                (data.get("tmdb_id"), data.get("original_title"), data.get("overview"), data.get("poster_url"), data.get("backdrop_url"), data.get("rating"), data.get("genres"), show_id),
            )

    def update_episode_metadata(self, episode_id: int, data: dict[str, Any]) -> None:
        with self.connect() as conn:
            conn.execute(
                """UPDATE episodes SET title=?,overview=?,still_url=?,runtime=?,air_date=?,metadata_status='matched',updated_at=CURRENT_TIMESTAMP WHERE id=?""",
                (data.get("title"), data.get("overview"), data.get("still_url"), data.get("runtime"), data.get("air_date"), episode_id),
            )

    def movie_by_id(self, movie_id: int):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM movies WHERE id=?", (movie_id,)).fetchone()
            return dict(row) if row else None

    def show_by_id(self, show_id: int):
        with self.connect() as conn:
            show = conn.execute("SELECT * FROM shows WHERE id=?", (show_id,)).fetchone()
            if not show:
                return None
            result = dict(show)
            eps = conn.execute("SELECT * FROM episodes WHERE show_id=? ORDER BY season,episode", (show_id,)).fetchall()
            result["episodes"] = [dict(x) for x in eps]
            return result

    def catalog(self):
        with self.connect() as conn:
            movies = [dict(x) for x in conn.execute("SELECT * FROM movies ORDER BY added_at DESC,title").fetchall()]
            shows = [dict(x) for x in conn.execute("SELECT * FROM shows ORDER BY added_at DESC,title").fetchall()]
            for show in shows:
                stats = conn.execute(
                    "SELECT COUNT(*) c, COUNT(DISTINCT season) s FROM episodes WHERE show_id=?", (show["id"],)
                ).fetchone()
                show["episode_count"] = stats["c"]
                show["season_count"] = stats["s"]
            return {"movies": movies, "shows": shows}

    def set_progress(self, source_url: str, position_ms: int, duration_ms: int, completed: bool):
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO progress(source_url,position_ms,duration_ms,completed) VALUES(?,?,?,?)
                ON CONFLICT(source_url) DO UPDATE SET position_ms=excluded.position_ms,duration_ms=excluded.duration_ms,
                completed=excluded.completed,updated_at=CURRENT_TIMESTAMP""",
                (source_url, position_ms, duration_ms, 1 if completed else 0),
            )

    def get_progress(self, source_url: str):
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM progress WHERE source_url=?", (source_url,)).fetchone()
            return dict(row) if row else {"source_url": source_url, "position_ms": 0, "duration_ms": 0, "completed": 0}
