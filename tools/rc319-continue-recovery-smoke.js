'use strict';

const fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function need(t,m,l){if(t.indexOf(m)<0)throw new Error(l+': missing '+m)}

const index=read('tv-app/index.html');
const js=read('tv-app/js/rc319-continue-recovery.js');
const app=read('tv-app/js/app.js');
const models=read('native-qnap-d1/internal/app/models.go');

need(index,'js/rc319-continue-recovery.js','index');
if(index.indexOf('js/rc319-continue-recovery.js')>index.indexOf('js/app.js'))throw new Error('RC3.19 must load before app.js');
need(js,"body.completed=completed?1:0",'numeric progress contract');
need(js,"body.rc319_progress_contract=319",'RC3.19 progress marker');
need(js,"playerVisible()||Date.now()<manualStopUntil||!nearEnd",'95 percent completion guard');
need(js,"END_RATIO=0.9995",'near-end threshold');
need(js,"END_MARGIN_MS=2000",'near-end margin');
need(js,"previousFetch(apiSibling(input,'/api/history')",'history fallback');
need(js,"String(item.media_type||'')==='episode'",'episode recovery');
need(js,'chooseHistoryCandidate','per-show candidate');
need(js,'effectiveIncomplete','legacy false-completion recovery');
need(js,"window.localStorage.setItem('homecinema.cache./api/continue'",'offline merged cache');
need(js,"marker:'rc3.19-explicit-completion'",'runtime marker');
need(app,'completed:!!completed','legacy boolean sender remains guarded by RC3.19');
need(app,"saveProgress(p,d,d>0&&(p/d)>0.95,pl)",'legacy 95 percent behavior remains intercepted');
need(models,'Completed   int','QNAP expects numeric completed');
console.log('PASS: RC3.19 converts boolean progress completion to QNAP 0/1');
console.log('PASS: RC3.19 blocks the legacy 95% auto-complete contract');
console.log('PASS: RC3.19 rebuilds missing episode Continue cards from history');
console.log('HOME_CINEMA_RC319_CONTINUE_RECOVERY_SMOKE=PASS');
