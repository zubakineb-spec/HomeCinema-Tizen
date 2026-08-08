from __future__ import annotations

import httpx

TMDB_API = "https://api.themoviedb.org/3"
TMDB_IMAGE = "https://image.tmdb.org/t/p"


class TmdbClient:
    def __init__(self, bearer_token: str, timeout: int = 12):
        self.token = bearer_token.strip()
        self.timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self.token)

    async def _get(self, path: str, params: dict | None = None):
        if not self.enabled:
            return None
        headers = {"Authorization": f"Bearer {self.token}", "accept": "application/json"}
        async with httpx.AsyncClient(timeout=self.timeout, headers=headers) as client:
            r = await client.get(TMDB_API + path, params=params or {})
            r.raise_for_status()
            return r.json()

    @staticmethod
    def image(path: str | None, size: str) -> str | None:
        return f"{TMDB_IMAGE}/{size}{path}" if path else None

    async def match_movie(self, title: str, year: int | None):
        params = {"query": title, "language": "ru-RU", "include_adult": "false"}
        if year:
            params["year"] = year
        found = await self._get("/search/movie", params)
        if not found or not found.get("results"):
            return None
        candidate = found["results"][0]
        details = await self._get(f"/movie/{candidate['id']}", {"language": "ru-RU"}) or candidate
        return {
            "tmdb_id": candidate["id"],
            "title": details.get("title") or title,
            "original_title": details.get("original_title"),
            "overview": details.get("overview") or "",
            "poster_url": self.image(details.get("poster_path"), "w500"),
            "backdrop_url": self.image(details.get("backdrop_path"), "w1280"),
            "rating": details.get("vote_average"),
            "runtime": details.get("runtime"),
            "genres": ", ".join(x.get("name", "") for x in details.get("genres", []) if x.get("name")),
        }

    async def match_show(self, title: str):
        found = await self._get("/search/tv", {"query": title, "language": "ru-RU", "include_adult": "false"})
        if not found or not found.get("results"):
            return None
        candidate = found["results"][0]
        details = await self._get(f"/tv/{candidate['id']}", {"language": "ru-RU"}) or candidate
        return {
            "tmdb_id": candidate["id"],
            "title": details.get("name") or title,
            "original_title": details.get("original_name"),
            "overview": details.get("overview") or "",
            "poster_url": self.image(details.get("poster_path"), "w500"),
            "backdrop_url": self.image(details.get("backdrop_path"), "w1280"),
            "rating": details.get("vote_average"),
            "genres": ", ".join(x.get("name", "") for x in details.get("genres", []) if x.get("name")),
        }

    async def episode(self, tmdb_show_id: int, season: int, episode: int):
        details = await self._get(f"/tv/{tmdb_show_id}/season/{season}/episode/{episode}", {"language": "ru-RU"})
        if not details:
            return None
        return {
            "title": details.get("name") or f"Серия {episode}",
            "overview": details.get("overview") or "",
            "still_url": self.image(details.get("still_path"), "w780"),
            "runtime": details.get("runtime"),
            "air_date": details.get("air_date"),
        }
