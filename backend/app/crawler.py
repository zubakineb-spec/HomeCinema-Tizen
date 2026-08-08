from __future__ import annotations

from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
import httpx

from .parser import VIDEO_EXTENSIONS


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        if tag.lower() != "a":
            return
        for key, value in attrs:
            if key.lower() == "href" and value:
                self.hrefs.append(value)


def _same_origin(a: str, b: str) -> bool:
    aa, bb = urlsplit(a), urlsplit(b)
    return (aa.scheme, aa.netloc) == (bb.scheme, bb.netloc)


def _is_video(url: str) -> bool:
    path = urlsplit(url).path.lower()
    return any(path.endswith(ext) for ext in VIDEO_EXTENSIONS)


async def crawl_http_directory(base_url: str, max_depth: int = 8, timeout: int = 12) -> list[str]:
    base_url = base_url.rstrip("/") + "/"
    queue: list[tuple[str, int]] = [(base_url, 0)]
    visited: set[str] = set()
    videos: set[str] = set()

    limits = httpx.Limits(max_connections=8, max_keepalive_connections=4)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True, limits=limits) as client:
        while queue:
            current, depth = queue.pop(0)
            normalized = current.split("#", 1)[0]
            if normalized in visited or depth > max_depth:
                continue
            visited.add(normalized)

            try:
                response = await client.get(current)
                response.raise_for_status()
            except (httpx.HTTPError, httpx.TimeoutException):
                continue

            content_type = response.headers.get("content-type", "")
            if "html" not in content_type.lower() and not response.text.lstrip().startswith("<"):
                continue

            parser = LinkParser()
            parser.feed(response.text)
            for href in parser.hrefs:
                if href.startswith(("?", "#", "javascript:", "mailto:")):
                    continue
                absolute = urljoin(current, href)
                if not _same_origin(base_url, absolute):
                    continue
                if not absolute.startswith(base_url):
                    continue
                if _is_video(absolute):
                    videos.add(absolute)
                    continue
                clean_path = urlsplit(absolute).path
                if depth < max_depth and (href.endswith("/") or clean_path.endswith("/")):
                    if absolute.rstrip("/") != current.rstrip("/"):
                        queue.append((absolute.rstrip("/") + "/", depth + 1))

    return sorted(videos)
