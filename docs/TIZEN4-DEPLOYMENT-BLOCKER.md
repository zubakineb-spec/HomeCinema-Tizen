# Samsung Tizen 4 deployment blocker

Status: **external blocker; feature development should continue independently**.

## Target

- TV: Samsung UE49NU7500 (2018)
- Platform: Tizen 4.0
- Firmware: `T-KTM2DEUC-1400.2, BT-S`
- TV IP: `192.168.0.103`
- DUID: `RLCFC64R2FIIE`
- Backend: QNAP D1 at `http://192.168.0.101:8096`

## Known-good historical control

The same TV successfully installed and launched HomeCinema `v0.3.9` and `v0.3.10` on 2026-08-09. The installer reached `installing[100]`, `install completed`, and the application launched.

## Current failure

A WGT transfers to `/home/owner/share/tmp/sdk_tools/tmp`, then the TV rejects installation before any `installing[n]` progress appears.

## Controls already executed

### Application/package

- original HomeCinema package/app ID
- side-by-side package/app ID
- minimal clean Web app (~27 KB)
- minimal manifest
- no application privileges
- `required_version=2.3`
- application assets/content/size excluded as root cause

### Current toolchain

- Tizen CLI `2.5.25`
- SDB `4.2.36`
- Samsung TV Extension `10.0.0`
- Samsung Certificate Extension `2.0.75`

Result: transfer succeeds, install fails before `installing[n]`.

### Legacy 2018 toolchain control

Isolated under `C:\TizenLegacy` without modifying the current SDK:

- Tizen CLI `2.4.48`
- SDB `4.1.3`
- Tizen Studio 3.0-era packages
- Samsung TV Extension `4.1.2`

The minimal `HC Clean` project builds successfully with the legacy CLI. Packaging also succeeds. Installation fails in the same pre-`installing[n]` phase.

### Certificates / permit

Tested both:

1. existing `HomeCinemaTV` Samsung TV profile;
2. completely fresh `HomeCinemaTV-FRESH` author + distributor profile.

For the fresh profile:

- author identity is cryptographically different from the old profile;
- `device-profile.xml` contains DUID `RLCFC64R2FIIE`;
- `install-permit` returns `Install Permitted`, exit code 0;
- SDB sees `UE49NU7500` as a connected device.

Result remains identical.

## Working conclusion

Do not change HomeCinema application logic to work around this failure. The evidence excludes the application source, manifest, package size, old/current packager, one specific certificate identity, DUID configuration, SDB connectivity, and `install-permit` as primary causes.

Treat the issue as a Samsung 2018 / Tizen 4.0 deployment or trust-chain compatibility problem until Samsung provides a resolution or a known-good certificate/deployment path is recovered.

Tracking issue: #10.

## Development policy while blocked

- Continue TV UI/player development in browser/static checks.
- Continue backend development and QNAP D1 validation independently.
- Keep WGT packaging as a build check, but do not use TV install success as a feature-development gate.
- Do not delete the isolated legacy SDK in `C:\TizenLegacy`; it is a useful reproducibility fixture.
- Do not replace or delete existing Samsung certificates while investigating.

## Current development baseline outside GitHub main

The working local TV branch is `HomeCinema-TV v0.3.18 Okko Player`. It includes the newer player UI, separate Movies/Shows shelves, and improved title normalization. GitHub `main` currently lags behind that local source and must be synchronized from the actual local `v0.3.18` directory rather than reconstructed from older repository code.
