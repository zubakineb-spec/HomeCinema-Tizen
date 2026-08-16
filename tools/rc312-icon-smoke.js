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
if(!normalize.includes('[int]$CanvasSize = 117'))fail('Samsung dev-install package canvas must remain 117x117');
if(!normalize.includes('[int]$TileWidth = 110'))fail('RC3.12 tile width must be 110px');
if(!normalize.includes('[int]$TileHeight = 62'))fail('RC3.12 tile height must be 62px');
if(!normalize.includes('ICON_TILE_ASPECT=16:9'))fail('RC3.12 icon must declare the wide 16:9 visual tile');
if(!normalize.includes('New-RoundedRectanglePath'))fail('RC3.12 icon must use rounded rectangular clipping');
if(!normalize.includes('Format32bppArgb'))fail('icon normalizer must keep transparent canvas padding');
if(!normalize.includes('HighQualityBicubic'))fail('icon normalizer must use high-quality resampling');
if(!release.includes('NORMALIZE SAMSUNG PACKAGE ICON'))fail('release pipeline does not normalize the Samsung package icon');
if(!release.includes('NORMALIZE-TV-ICON.ps1'))fail('release pipeline does not call the icon normalizer');
if(!release.includes('-TileWidth 110 -TileHeight 62'))fail('release pipeline does not request RC3.12 wide tile geometry');
if(!release.includes("icon_tile = '110x62'"))fail('release manifest does not identify the RC3.12 wide icon tile');

console.log('PASS: Samsung dev-install icon keeps 117x117 package canvas with a centered 110x62 wide tile');
console.log('PASS: RC3.12 release pipeline requests 16:9 launcher artwork before signing');
console.log('HOME_CINEMA_RC312_ICON_SMOKE=PASS');
