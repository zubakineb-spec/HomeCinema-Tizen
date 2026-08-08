# Changelog

## 0.3.0 - 2026-08-08
- Target hardware profile: Samsung UE49NU7500U (2018, Tizen 4.0 / Chromium M56).
- Added ffprobe codec analysis before playback.
- Added automatic AVPlay selection of a non-DTS audio track when available.
- Added DTS-only HLS fallback: video stream copy, AAC stereo audio conversion via FFmpeg.
- Added target-TV and FFmpeg/ffprobe readiness to `/api/health`.
- Restricted compatibility resolver to `MEDIA_BASE_URL` to prevent arbitrary LAN/Internet proxying.
- Added Samsung 2018 playback compatibility tests.

## 0.2.1 - 2026-08-08
- Added an in-app Credits/About screen for TMDB attribution.
- Added the required TMDB API non-endorsement notice.
- Documented that an approved TMDB logo asset must be used before redistribution.

## 0.2.0 - 2026-08-08
- Added TV search, continue watching, season grouping, AVPlay audio/subtitle track selection and Samsung remote focus hardening.

## 0.1.0 - 2026-08-08
- Initial Home Cinema MVP with HTTP media scanner, TMDb metadata, SQLite catalog and Samsung Tizen AVPlay client.
