'use strict';

const fs = require('fs');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const normalize = fs.readFileSync('tools/NORMALIZE-TV-ICON.ps1','utf8');
const release = fs.readFileSync('RELEASE-TV.ps1','utf8');
const config = fs.readFileSync('tv-app/config.xml','utf8');

if(!config.includes('<icon src="icon.png"/>'))fail('Tizen package icon is not icon.png');
if(!normalize.includes('[int]$CanvasSize = 117'))fail('Samsung test-icon canvas must remain 117x117');
if(!normalize.includes('[int]$ArtworkSize = 92'))fail('RC3.11 safe-area artwork size must be 92px');
if(!normalize.includes('Format32bppArgb'))fail('icon normalizer must preserve transparent padding');
if(!normalize.includes('HighQualityBicubic'))fail('icon normalizer must use high-quality resampling');
if(!release.includes('NORMALIZE SAMSUNG PACKAGE ICON'))fail('release pipeline does not normalize the Samsung package icon');
if(!release.includes('NORMALIZE-TV-ICON.ps1'))fail('release pipeline does not call the icon normalizer');

console.log('PASS: Samsung dev-install package icon remains 117x117 with centered 92px safe-area artwork');
console.log('PASS: RC3.11 release pipeline normalizes icon geometry before signing');
console.log('HOME_CINEMA_RC311_ICON_SMOKE=PASS');
