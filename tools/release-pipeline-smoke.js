'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const release = fs.readFileSync(path.join(__dirname, '..', 'RELEASE-TV.ps1'), 'utf8').replace(/\r\n?/g, '\n');
const install = fs.readFileSync(path.join(__dirname, '..', 'INSTALL-SAMSUNG-WGT.ps1'), 'utf8').replace(/\r\n?/g, '\n');

function main() {
  assert(release.includes('[switch]$Install'), 'TV installation must be explicit opt-in');
  assert(release.includes("if ($Install) {"), 'release pipeline must guard TV installation');
  assert(release.includes("'BUILD-SAMSUNG-WGT.ps1'"), 'release pipeline must use the signed build script');
  assert(release.includes("'author-signature.xml'"), 'release pipeline must verify author signature presence');
  assert(release.includes("'signature1.xml'"), 'release pipeline must verify distributor signature presence');
  assert(release.includes('Get-FileHash $Target -Algorithm SHA256'), 'release pipeline must hash the final WGT');
  assert(release.includes('ConvertTo-Json'), 'release pipeline must produce a release manifest');
  assert(install.includes('[string]$Serial'), 'installer must accept actual SDB serial');
  assert(install.includes('[string]$TvIp'), 'installer must resolve serial from TV IP');
  assert(install.includes('tizen install -s $Serial'), 'installer must support serial-based install');
  assert(install.includes("throw 'Specify -Serial, -TvIp, or legacy -Target. No installation was attempted.'"), 'installer must fail closed without an explicit device');

  console.log('PASS: release defaults to build/verify only');
  console.log('PASS: signed WGT verification and SHA-256 manifest are required');
  console.log('PASS: TV installation requires explicit device resolution');
  console.log('HOME_CINEMA_RELEASE_PIPELINE_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
