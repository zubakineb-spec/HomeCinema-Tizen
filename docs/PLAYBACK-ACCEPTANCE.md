# Home Cinema NAS playback acceptance

This stage validates the existing Home Cinema player already hosted on the QNAP NAS. It does **not** install another player.

## Target

- QNAP D1 / QTS 4.3.6
- Home Cinema runtime 0.3.8
- NAS URL: `http://192.168.0.101:8096/`
- Current library: 90 video files, 8 movies, 11 shows, 81 real episodes and 1 extra

## Run

From Windows PowerShell 5.1:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\tools\VERIFY-PLAYBACK-v0.3.9.ps1
```

The script first verifies HTTP Range transport for three real media items from the live catalog, then opens the existing NAS player and records manual playback checks.

## Required checks

1. Home page renders normally with posters and metadata.
2. `Evil Dead Burn` (or the first available movie if it is absent) starts with video and audio and plays for at least 30 seconds.
3. Pause and resume work.
4. Seek forward works and playback continues.
5. Seek backward works and playback continues.
6. Returning to the home page creates a `Продолжить просмотр` entry.
7. Starting from `Продолжить просмотр` resumes near the saved position.
8. `After Life` episode playback works.
9. `Pasha` shows `Фильм о фильме` under `Доп. материалы` rather than as episode 9.
10. The `Фильм о фильме` extra plays with video and audio.

Successful completion prints and writes:

```text
HOME_CINEMA_PLAYBACK_ACCEPTANCE=PASS
```

The generated report is saved to the Windows Desktop.

## Out of scope for this stage

Samsung-specific AVPlay behavior is intentionally tested only on the target Samsung UE49NU7500U. That later stage covers audio-track switching, subtitle switching, Smart Remote behavior and TV codec compatibility.
