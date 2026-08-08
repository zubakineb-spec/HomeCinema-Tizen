from __future__ import annotations

import asyncio
from .crawler import crawl_http_directory
from .parser import parse_media_url
from .db import Database
from .tmdb import TmdbClient


async def scan_library(db: Database, tmdb: TmdbClient, base_url: str, max_depth: int, timeout: int):
    urls = await crawl_http_directory(base_url, max_depth=max_depth, timeout=timeout)
    movies: list[tuple[int, str, int | None]] = []
    shows: dict[int, dict] = {}
    ignored = 0

    for url in urls:
        parsed = parse_media_url(url, base_url)
        if not parsed:
            ignored += 1
            continue
        if parsed.kind == "movie":
            mid = db.upsert_movie(url, parsed.title, parsed.year)
            movies.append((mid, parsed.title, parsed.year))
        else:
            show_id = db.upsert_show(parsed.show_title or "Неизвестный сериал")
            episode_id = db.upsert_episode(show_id, url, parsed.season or 0, parsed.episode or 0, parsed.title)
            info = shows.setdefault(show_id, {"title": parsed.show_title or "Неизвестный сериал", "episodes": []})
            info["episodes"].append((episode_id, parsed.season or 0, parsed.episode or 0))

    metadata = {"movies_matched": 0, "shows_matched": 0, "episodes_matched": 0}
    if tmdb.enabled:
        for movie_id, title, year in movies:
            try:
                data = await tmdb.match_movie(title, year)
                if data:
                    db.update_movie_metadata(movie_id, data)
                    metadata["movies_matched"] += 1
            except Exception:
                pass
            await asyncio.sleep(0.04)

        for show_id, info in shows.items():
            tmdb_show_id = None
            try:
                show_data = await tmdb.match_show(info["title"])
                if show_data:
                    db.update_show_metadata(show_id, show_data)
                    tmdb_show_id = show_data.get("tmdb_id")
                    metadata["shows_matched"] += 1
            except Exception:
                pass
            if tmdb_show_id:
                for episode_id, season, episode in info["episodes"]:
                    try:
                        ep = await tmdb.episode(tmdb_show_id, season, episode)
                        if ep:
                            db.update_episode_metadata(episode_id, ep)
                            metadata["episodes_matched"] += 1
                    except Exception:
                        pass
                    await asyncio.sleep(0.04)

    return {
        "source": base_url,
        "video_files": len(urls),
        "movies": len(movies),
        "shows": len(shows),
        "episodes": sum(len(x["episodes"]) for x in shows.values()),
        "ignored": ignored,
        "tmdb_enabled": tmdb.enabled,
        **metadata,
    }
