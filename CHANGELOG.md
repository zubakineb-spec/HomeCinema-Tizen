# Changelog

## 0.3.18 RC3.11 Back + Samsung icon hotfix - 2026-08-16

- Fixed `Back` on the dedicated RC3.10 series page: the root application-exit guard now treats an open `series310Page` as a nested screen, so Back closes the series page instead of exiting Home Cinema.
- Added `rc311-series-back-smoke.js` and extended the existing root-Back regression gate so player, details, search, About and the series browser all retain nested Back behavior.
- Normalized the Tizen development package icon used by direct Tizen Studio installs: the required 117×117 canvas is preserved while the artwork is centered inside a 92×92 safe area with transparent padding so Home Cinema visually matches neighboring Samsung app icons.
- Added `NORMALIZE-TV-ICON.ps1`, an RC3.11 icon regression gate and signed-WGT verification for the 117×117 package icon.
- Updated `RELEASE-TV.ps1` default release candidate to `rc3.11` and made both Back and icon fixes mandatory before signing/installing.

## 0.3.18 RC3.10 compact home + series page - 2026-08-16

- Reduced the cinematic Home hero height from the RC3.9 layout and pulled the content shelves upward so more of the library is visible without losing the backdrop-first look.
- Removed the Home-screen `Смотреть` and `Подробнее` CTA buttons from the visible layout.
- Removed movie/show titles, metadata and `ФИЛЬМ` / `СЕРИАЛ` type labels below/on catalog cards; landscape artwork, rating and focus frame remain the primary selection cues.
- Added a dedicated full-screen series browser page opened from any show card, including Search results.
- The new series page has its own backdrop/title/metadata area, a separate season selector and a separate episode rail; OK on an episode keeps the existing `data-play-source` AVPlay contract.
- Back closes the series page, while Back inside AVPlay remains handled by the proven player code; returning from playback keeps the series page available underneath.
- Added `rc310-series-page-smoke.js`, CI coverage and signed-WGT release verification for the new compact Home and series-page layer.

## 0.3.18 RC3.9 cinematic UI - 2026-08-16

- Reworked the Samsung home screen into a full-bleed cinematic layout inspired by modern streaming interfaces: large backdrop hero, oversized title, compact metadata line and content shelves overlapping the lower hero area.
- Switched movie/show catalog cards to 420×236 landscape tiles and made cards prefer TMDB backdrop artwork over portrait posters.
- Added green rating badges, white focus frames and a subtle scale-up state for the selected card.
- Restyled hero metadata, descriptions, buttons, details view and episode cards while leaving the proven RC3.8 AVPlay/player geometry unchanged.
- Added dynamic RC3.9 decoration so cards and hero metadata remain styled after catalog refreshes, focus changes and offline-cache restoration.
- Added `cinematic-ui-smoke.js`, CI coverage and release-package verification for the new UI layer.

## 0.3.18 RC3.8 - 2026-08-16

- Fixed a Samsung Tizen native-layer artifact where the focused search input could remain visible over AVPlay/details viewing.
- Added an isolated `rc38-search-surface.js` guard that blurs the search input, removes its focus marker, hides the input native surface and hides the search overlay before details/player viewing.
- When a details card was opened from Search, Back now restores the real Search mode through the existing navigation handler instead of exposing a stale input layer.
- Added `search-player-surface-smoke.js` and CI coverage; all existing AVPlay, Back, D-pad, Tizen 4, backend and ARMv7 build gates remain green.
- Updated `RELEASE-TV.ps1` default candidate to `rc3.8` and made the signed WGT verification require the search-surface fix.

## 0.3.18 RC3.7 engineering - 2026-08-15

- Added one-command `RELEASE-TV.ps1` pipeline for local tests, signed WGT build, package verification, SHA-256 manifest and optional TV install; installation is opt-in through `-Install` and is not part of the default release path.
- Reworked `INSTALL-SAMSUNG-WGT.ps1` to support the real SDB serial / TV IP path while retaining legacy named targets.
- Added QNAP-side TMDB artwork caching through `/api/image`; Samsung clients map TMDB artwork to the NAS cache and can reuse the cached catalog when the NAS is temporarily unavailable.
- Added resilient TV-to-NAS networking: GET retry/backoff, online/offline state, cached catalog/details/search, queued playback progress and automatic queue flush after reconnect.
- Added `/api/diagnostics` plus a TV diagnostics/settings screen with backend status, endpoint, runtime, ffprobe/FFmpeg readiness, image-cache counts, AVPlay state and current media source.
- Persist media compatibility profiles during scan: container, video codec, resolution, HDR flag, audio/subtitle codecs and `direct` / `dts_only` / `review` classification.
- Added streaming UX: viewing history, favorites, sort/filter, watched/progress markers, Continue/Start Over, compatibility badges and next-episode lookup/autoplay countdown.
- Added player UX: 10→30→60 second accelerated timeline scrub while holding Left/Right, per-series audio/subtitle preference restore and configurable subtitle size.
- Added incremental QNAP scanning based on source URL + file size + mtime so unchanged files reuse existing media profiles while new/changed files are re-profiled and removed files are counted.
- Hardened `catalog.json` and `progress.json` persistence with file fsync, atomic rename, directory sync, three backup generations and automatic recovery from the newest valid backup.
- Added dedicated RC3.7 JavaScript and Go regression tests and CI gates.
- Signed `HomeCinema-Tizen-v0.3.18-rc3.7.wgt` was subsequently installed successfully on the physical Samsung UE49NU7500U and used as the baseline where the search-input native-layer artifact was observed.

## 0.3.18 RC3.6 - 2026-08-15

- Confirmed signed WGT installation and launch on the physical Samsung UE49NU7500U.
- Restored D-pad navigation after leaving the player by clearing stale hidden timeline focus before legacy remote handlers run.
- Added regression coverage proving the first Left/Right press after player exit remains available to catalog navigation.
- Fixed `Back` on the root Home Cinema screen to call the Tizen application exit API while preserving nested Back behavior in player, details, search and About.
- `HomeCinema-Tizen-v0.3.18-rc3.6.wgt` is the last TV-validated release before the RC3.7 engineering changes.

## 0.3.8 - 2026-08-09

- Added application-level TMDB DNS recovery for networks where `api.themoviedb.org` is incorrectly resolved to a local address.
- Normal system DNS remains the first path; on transport/TLS failure the client retries resolution over HTTPS using Cloudflare and Google Public DNS bootstrap addresses.
- Added a final set of public TMDB CDN seed addresses for recovery when encrypted DNS itself is unavailable; stale or hijacked addresses remain harmless because normal hostname TLS certificate verification is still mandatory.
- Rejects loopback, RFC1918, link-local, CGNAT and multicast DNS answers from the fallback path.
- Added regression tests proving fallback activation, host scoping, HTTP-error preservation and that TLS verification is never disabled.

## 0.3.7 - 2026-08-09

- Reclassified the target-library `Pasha S01E09` file as the local extra `Фильм о фильме` instead of a ninth episode.
- Added explicit `extra` content type and local metadata status so bonus material is never sent to TMDB episode lookup.
- Show/catalog API now reports real episodes and extras separately (`81` episodes + `1` extra for the current 90-file library).
- Samsung TV UI now renders extras under `Доп. материалы`; show cards display counts such as `8 сер. • 1 доп.`.
- Pinned ambiguous `After Life` metadata to the verified TMDB series ID `79410` so pending S01E05/S01E06 are retried against the correct 2019 series.

## 0.3.6 - 2026-08-08

- Added retry/backoff for transient TMDB network, HTTP 429 and 5xx failures.
- Added Russian title aliases `Holod -> Холод` and `Na ldu -> На льду` for the target QNAP library.
- Recovered metadata for both previously unmatched series and their local episodes.

## 0.3.5 - 2026-08-08

- Added live `--tmdb-test` diagnostics for authenticated TMDB connectivity.
- Exposed exact TMDB HTTP/DNS/TLS failures instead of silently collapsing them into zero matched items.
- Diagnosed the target QNAP DNS path returning the NAS itself for `api.themoviedb.org`; temporary `/etc/hosts` routing restored valid TLS/TMDB access without disabling certificate validation.

## 0.3.4 - 2026-08-08

- Normalized real-world movie release filenames before TMDB matching.
- Preserved title words such as `Multi-Pulti` instead of treating `Multi` as a language tag.
- Added handling for release/source tags such as `MA`, `DCPRip`, `AMZN` and common streaming-source markers.
- Added regression coverage for the eight movie filenames observed on the target QNAP D1 library.

## 0.3.3 - 2026-08-08

- Added QTS 4.3.6 / BusyBox 1.01 compatibility by removing unsupported `dirname --`, `cd --` and `nohup` usage.
- Added QNAP service launch compatible with the target D1 firmware.
- Skipped QNAP-generated thumbnail/recycle directories during media scans.
- Added series parsing for dotted episode notation such as `S01.E05`.
- Improved release-directory cleanup for series titles such as `After Life` and `The Dark`.

## 0.3.2 - 2026-08-08

- Added native QNAP D1 runtime for ARMv7 / QTS 4.3.6 without Docker or Python.
- Added statically linked ARMv7 Go backend with local media scan, catalog, search, series seasons, progress and TMDB metadata.
- Added native `/media/` HTTP serving with byte-range support for Samsung Direct Play.
- Added QTS service registration and SSH installer/preflight/uninstaller scripts.
- Split catalog and playback progress persistence to reduce write load on the 1 GB D1.
- Added optional ffprobe/FFmpeg DTS fallback; disabled by default on D1 to protect CPU headroom.
- Added GitHub CI ARMv7 cross-build and install-bundle artifact.

## 0.3.1 - 2026-08-08

- Added NAS-first deployment: backend runs directly on the NAS.
- Added `MEDIA_LOCAL_ROOT` for local filesystem scanning and FFmpeg/ffprobe input.
- Kept `MEDIA_BASE_URL` as the public Direct Play URL used by Samsung TV.
- Added Dockerfile, NAS Compose deployment and persistent data/HLS volumes.

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
- Kept the home-cinema runtime and media catalog behavior unchanged from 0.2.0.

## 0.2.0 - 2026-08-08

- Added TV search for movies and series.
- Added "Продолжить просмотр" feed from local playback progress.
- Added explicit season grouping and season tabs for series stored in folders.
- Added episode cards with stills, descriptions, runtime and air date when TMDb provides them.
- Added Samsung AVPlay audio/subtitle track panel using native track APIs.
- Added subtitle enable/disable control and AVPlay multitasking suspend/restore handling.
- Improved Samsung Smart Remote focus navigation and TV-first layout.
- Added database tests for season grouping, search and continue-watching behavior.
- Fixed Samsung remote focus after changing seasons and synchronized visual/DOM focus.
- Added GitHub Actions CI for backend tests, compile checks and TV JavaScript syntax checks.
- Added signed WGT build/install PowerShell scripts and Samsung Developer Mode setup guide.

## 0.1.0 - 2026-08-08

- Initial Home Cinema MVP.
- HTTP media-source scanner for `http://192.168.0.101/`.
- Recursive folder scanning for movies and TV shows.
- TV-series recognition by `S01E01`, `1x01`, season folders, and numeric episode files.
- TMDb movie/TV metadata integration with Russian locale.
- SQLite catalog and playback progress storage.
- Samsung Tizen TV client with Smart Remote navigation.
- Samsung AVPlay integration with HTML5 video fallback.
- Manual metadata-match queue foundation for ambiguous media.
