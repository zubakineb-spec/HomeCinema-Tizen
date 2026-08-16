'use strict';

const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('tv-app/index.html');
const css=read('tv-app/css/rc310-home-series.css');
const js=read('tv-app/js/rc310-series-page.js');

function must(ok,msg){if(!ok){console.error('FAIL: '+msg);process.exit(1)}console.log('PASS: '+msg)}

must(html.includes('css/rc310-home-series.css'),'RC3.10 stylesheet is loaded');
must(html.includes('js/rc310-series-page.js'),'RC3.10 series page script is loaded');
must(html.indexOf('js/rc310-series-page.js')<html.indexOf('js/app.js'),'series interceptor loads before app click/key handlers');

must(css.includes('height:610px'),'home hero is shorter than RC3.9');
must(css.includes('.hero-actions{display:none!important}'),'home hero Watch/Details actions are hidden');
must(css.includes('.media-title,.media-meta,.kind{display:none!important}'),'movie/show captions and type labels are removed from cards');
must(css.includes('.series310-page'),'dedicated series page styles exist');
must(css.includes('.series310-season-rail'),'dedicated season selector exists');
must(css.includes('.series310-episode-rail'),'dedicated episode rail exists');

must(js.includes("window.HOME_CINEMA_RC='rc3.10-series-page'"),'RC3.10 runtime marker is present');
must(js.includes("[data-card-type=\"show\"]"),'show-card clicks are intercepted into the dedicated page');
must(js.includes("'/api/shows/'"),'series page loads show details from the backend');
must(js.includes('data-series310-season'),'season selection is rendered separately');
must(js.includes('data-play-source'),'episode cards retain the proven playback contract');
must(js.includes('playerVisible()'),'series navigation yields control to the existing AVPlay player');
must(js.includes('code===10009||code===27'),'Back closes the dedicated series page');

console.log('HOME_CINEMA_RC310_SERIES_PAGE_SMOKE=PASS');
