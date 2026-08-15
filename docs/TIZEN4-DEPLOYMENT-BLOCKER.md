# Samsung Tizen 4 deployment blocker

Status: **external deployment blocker**. Home Cinema `v0.3.18` is already merged to `main` and passes the permanent Tizen 4 / Chromium 56 / player lifecycle / release-candidate CI gates. Feature work and deployment investigation are intentionally separated.

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

- Keep `v0.3.18` functional baseline stable in `main`.
- Continue backend/QNAP validation independently when needed.
- Keep WGT packaging as a build check, but do not use TV install success as an application-code gate.
- Do not delete the isolated legacy SDK in `C:\TizenLegacy`; it is a reproducibility fixture.
- Do not replace or delete existing Samsung certificates while investigating.

## Next deployment experiment

Use the official Samsung/Tizen Studio re-import path as the next controlled test:

1. build a signed WGT from the `v0.3.18` baseline;
2. import the produced `.wgt` into Tizen Studio as a new Tizen Web project;
3. target the Samsung TV / Tizen 4.0 platform;
4. deploy that imported project to the same UE49NU7500;
5. compare the result with the direct CLI install path.

If this still fails before `installing[n]`, keep the failure in issue #10 as a Samsung/toolchain/TV trust-state blocker rather than modifying the HomeCinema application.