# Home Cinema v0.3.18 RC3.14

RC3.14 is the combined Samsung TV + QNAP release for the current Home Cinema baseline.

## Included fixes and features

- Keeps the RC3.13 player seek-surface hotfix: scrub preview/fill is cleared immediately, idle timeline focus no longer blocks chrome auto-hide, and a seek watchdog prevents stale UI if Samsung AVPlay omits a callback.
- Keeps the RC3.11 series-page Back fix and the existing RC3.10 dedicated season/episode browser.
- Adds compact audio attribution in the Samsung player without changing AVPlay track selection.
- QNAP `ffprobe` profiling now captures per-audio-track language, title, handler name, codec, channels/channel layout, recognized dubbing studio and explicit translation type.
- Known studio names are recognized only from file metadata; Home Cinema does not invent a studio when the media file does not provide one.
- Compact TV presentation uses two lines, for example:

  `Русский — LostFilm`

  `MVO · AC3 · 5.1`

- If no studio is identified, the first line remains the AVPlay language label; a non-generic embedded track title may be shown as factual attribution.
- Continue/history and next-episode API payloads now carry `media_profile`, so attribution can follow playback started outside the series browser as well.

## QNAP requirement

The TV WGT alone cannot discover MKV track titles. RC3.14 therefore includes both TV and QNAP changes. Deploy the RC3.14 QNAP ARMv7 bundle and run a library scan so existing media profiles are refreshed with `audio_tracks` metadata. Files unchanged since older releases still need one RC3.14 scan because their cached profiles predate per-track metadata.

## Release gates

RC3.14 requires all existing AVPlay, Back, D-pad, Tizen 4, search-surface, cinematic UI and series-page gates plus:

- RC3.13 seek-surface regression gate.
- RC3.14 compact audio metadata gate.
- Go unit tests for studio/translation detection and safe media-path resolution.
- QNAP ARMv7 cross-build.
- Signed-WGT verification requiring both the RC3.13 seek fix and RC3.14 audio metadata layer.
