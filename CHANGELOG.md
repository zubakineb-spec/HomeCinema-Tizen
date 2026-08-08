# Changelog

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
