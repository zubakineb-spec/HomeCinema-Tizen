from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath
import re
import urllib.parse

VIDEO_EXTENSIONS = {".mkv", ".mp4", ".m4v", ".avi", ".mov", ".ts", ".m2ts", ".webm"}

SEASON_DIR_PATTERNS = [
    re.compile(r"^(?:season|сезон)[ ._-]*(\d{1,2})$", re.I),
    re.compile(r"^s(\d{1,2})$", re.I),
]
EPISODE_PATTERNS = [
    re.compile(r"(?i)(?:^|[ ._\-])S(\d{1,2})E(\d{1,3})(?:E\d{1,3})?"),
    re.compile(r"(?i)(?:^|[ ._\-])(\d{1,2})x(\d{1,3})(?:[ ._\-]|$)"),
]
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
QUALITY_TOKENS = re.compile(
    r"(?i)\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10\+?|hdr|dv|dolby[ ._-]?vision|"
    r"bluray|blu[ ._-]?ray|bdrip|webrip|web[ ._-]?dl|remux|h\.?26[45]|hevc|x26[45]|"
    r"aac|ac3|eac3|dts(?:-hd)?|truehd|atmos|proper|repack|extended|multi)\b.*$"
)
BRACKET_RE = re.compile(r"\[[^\]]*\]|\([^)]*(?:rip|codec|audio|video|gb|mb)[^)]*\)", re.I)


@dataclass(frozen=True)
class ParsedMedia:
    kind: str  # movie | episode
    title: str
    year: int | None = None
    show_title: str | None = None
    season: int | None = None
    episode: int | None = None


def decode_name(value: str) -> str:
    return urllib.parse.unquote(value).replace("+", " ")


def clean_title(raw: str) -> str:
    value = decode_name(raw)
    value = PurePosixPath(value).stem
    value = BRACKET_RE.sub(" ", value)
    value = QUALITY_TOKENS.sub("", value)
    value = re.sub(r"[._]+", " ", value)
    value = re.sub(r"\s*[-–—]\s*", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" ._-—")
    return value.strip()


def season_from_dir(name: str) -> int | None:
    clean = decode_name(name).strip("/ ")
    for pattern in SEASON_DIR_PATTERNS:
        match = pattern.match(clean)
        if match:
            return int(match.group(1))
    return None


def _episode_from_filename(filename: str) -> tuple[int, int] | None:
    stem = decode_name(PurePosixPath(filename).stem)
    for pattern in EPISODE_PATTERNS:
        match = pattern.search(stem)
        if match:
            return int(match.group(1)), int(match.group(2))
    return None


def _numeric_episode(filename: str) -> int | None:
    stem = decode_name(PurePosixPath(filename).stem).strip()
    match = re.match(r"^(?:e|ep|episode|серия)?[ ._-]*(\d{1,3})(?:\D.*)?$", stem, re.I)
    if match:
        return int(match.group(1))
    return None


def _strip_episode_tokens(title: str) -> str:
    value = title
    for pattern in EPISODE_PATTERNS:
        value = pattern.sub(" ", value)
    value = re.sub(r"(?i)\b(?:episode|ep|серия)\s*\d{1,3}\b", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def parse_media_url(url: str, base_url: str) -> ParsedMedia | None:
    parsed = urllib.parse.urlsplit(url)
    path = PurePosixPath(parsed.path)
    if path.suffix.lower() not in VIDEO_EXTENSIONS:
        return None

    base_path = PurePosixPath(urllib.parse.urlsplit(base_url).path or "/")
    try:
        rel = path.relative_to(base_path)
    except ValueError:
        rel = path

    parts = [decode_name(p) for p in rel.parts if p not in ("/", "")]
    if not parts:
        return None

    filename = parts[-1]
    parent_dirs = parts[:-1]

    direct_episode = _episode_from_filename(filename)
    season_dir_index = None
    season_dir_number = None
    for idx in range(len(parent_dirs) - 1, -1, -1):
        number = season_from_dir(parent_dirs[idx])
        if number is not None:
            season_dir_index = idx
            season_dir_number = number
            break

    if direct_episode:
        season, episode = direct_episode
        if season_dir_index is not None and season_dir_index > 0:
            show_title = clean_title(parent_dirs[season_dir_index - 1])
        elif parent_dirs:
            show_title = clean_title(parent_dirs[-1])
        else:
            raw = _strip_episode_tokens(clean_title(filename))
            show_title = raw or "Неизвестный сериал"
        return ParsedMedia(
            kind="episode",
            title=f"Серия {episode}",
            show_title=show_title,
            season=season,
            episode=episode,
        )

    numeric_episode = _numeric_episode(filename)
    if season_dir_index is not None and numeric_episode is not None:
        show_title = (
            clean_title(parent_dirs[season_dir_index - 1])
            if season_dir_index > 0
            else "Неизвестный сериал"
        )
        return ParsedMedia(
            kind="episode",
            title=f"Серия {numeric_episode}",
            show_title=show_title,
            season=season_dir_number,
            episode=numeric_episode,
        )

    raw = clean_title(filename)
    year_match = YEAR_RE.search(raw)
    year = int(year_match.group(1)) if year_match else None
    title = YEAR_RE.sub(" ", raw)
    title = re.sub(r"\s+", " ", title).strip()
    return ParsedMedia(kind="movie", title=title or raw, year=year)
