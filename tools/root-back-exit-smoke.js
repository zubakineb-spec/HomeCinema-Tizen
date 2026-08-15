'use strict';

const fs = require('fs');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const release = fs.readFileSync('tv-app/js/rc-release.js','utf8');
const app = fs.readFileSync('tv-app/js/app.js','utf8');

if(!release.includes('function rootScreenActive()'))fail('root screen guard is missing');
if(!release.includes("hidden('details')"))fail('details screen is not excluded from root exit');
if(!release.includes("hidden('searchOverlay')"))fail('search overlay is not excluded from root exit');
if(!release.includes('!playerVisible()'))fail('player is not excluded from root exit');
if(!release.includes('!aboutOpen()'))fail('about overlay is not excluded from root exit');
if(!release.includes("if((code===10009||code===27)&&rootScreenActive())"))fail('Back key is not wired to root exit');
if(!release.includes('tizen.application.getCurrentApplication().exit()'))fail('Tizen application exit call is missing');

if(!app.includes("if(state.mode==='details'){consume(e);closeDetails();return false}"))fail('details Back behavior regressed');
if(!app.includes("if(state.mode==='search'){consume(e);closeSearch(true)"))fail('search Back behavior regressed');
if(!app.includes("if(state.mode==='player')"))fail('player Back behavior regressed');

console.log('PASS: Back exits Home Cinema only from the root screen');
console.log('PASS: player, details, search and about retain nested Back behavior');
console.log('HOME_CINEMA_ROOT_BACK_EXIT_SMOKE=PASS');
