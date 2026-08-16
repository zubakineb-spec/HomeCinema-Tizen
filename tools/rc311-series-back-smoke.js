'use strict';

const fs = require('fs');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const release = fs.readFileSync('tv-app/js/rc-release.js','utf8');
const series = fs.readFileSync('tv-app/js/rc310-series-page.js','utf8');

if(!release.includes('function seriesPageOpen()'))fail('series-page guard is missing from root Back handler');
if(!release.includes("document.getElementById('series310Page')"))fail('root Back guard does not inspect RC3.10 series page');
if(!release.includes('!seriesPageOpen()'))fail('open series page is not excluded from root application exit');
if(!series.includes("if(code===10009||code===27){consume(e);closeSeriesPage();return false}"))fail('series page does not own Back navigation');
if(!series.includes('function closeSeriesPage()'))fail('series page close routine is missing');

console.log('PASS: root application exit is disabled while the RC3.10 series page is open');
console.log('PASS: Back on the series page is reserved for closeSeriesPage()');
console.log('HOME_CINEMA_RC311_SERIES_BACK_SMOKE=PASS');
