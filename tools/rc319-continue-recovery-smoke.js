'use strict';

const fs=require('fs');
const vm=require('vm');
function read(p){return fs.readFileSync(p,'utf8')}
function need(t,m,l){if(t.indexOf(m)<0)throw new Error(l+': missing '+m)}
function assert(v,m){if(!v)throw new Error(m)}

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

const player={classList:{contains:function(name){return name==='hidden'}}};
const storage={};
const context={
  Promise:Promise,JSON:JSON,Date:Date,Math:Math,Number:Number,String:String,Object:Object,Array:Array,isFinite:isFinite,
  document:{querySelector:function(sel){return sel==='#player'?player:null}},
  window:{
    fetch:function(){return Promise.reject(new Error('not used'))},
    addEventListener:function(){},
    localStorage:{setItem:function(k,v){storage[k]=v}},
    Response:undefined
  }
};
vm.runInNewContext(js,context,{filename:'rc319-continue-recovery.js'});
const api=context.window.HOME_CINEMA_RC319;
assert(api&&api.marker==='rc3.19-explicit-completion','RC3.19 runtime API missing');

let opts=api.rewriteProgressOptions({method:'POST',body:JSON.stringify({source_url:'ep2',position_ms:570000,duration_ms:600000,completed:true})});
let body=JSON.parse(opts.body);
assert(body.completed===0,'95% autosave must remain incomplete');
assert(body.rc319_progress_contract===319,'progress contract marker missing');

opts=api.rewriteProgressOptions({method:'POST',body:JSON.stringify({source_url:'ep2',position_ms:599500,duration_ms:600000,completed:true})});
body=JSON.parse(opts.body);
assert(body.completed===1,'true near-end completion should remain completed');

opts=api.rewriteProgressOptions({method:'POST',body:JSON.stringify({source_url:'ep2',position_ms:200000,duration_ms:600000,completed:false})});
body=JSON.parse(opts.body);
assert(body.completed===0&&typeof body.completed==='number','QNAP completed must be numeric 0/1');

const history={items:[
  {media_type:'episode',show_id:7,season:1,episode:1,source_url:'ep1',position_ms:600000,duration_ms:600000,completed:1,updated_at:'2026-08-15T20:00:00Z',parent_title:'Test Show',title:'Series 1'},
  {media_type:'episode',show_id:7,season:1,episode:2,source_url:'ep2',position_ms:576000,duration_ms:600000,completed:1,updated_at:'2026-08-16T20:00:00Z',parent_title:'Test Show',title:'Series 2'}
]};
const recovered=api.recoveredEpisodes(history.items);
assert(recovered['7'],'legacy S01E02 should be recoverable');
assert(recovered['7'].source_url==='ep2','highest unfinished episode must win legacy recovery');
assert(recovered['7'].completed===0,'recovered episode must be resumable');

let merged=api.mergeContinueData({items:[]},history);
assert(merged.items.length===1,'missing series should be restored to Continue');
assert(merged.items[0].source_url==='ep2','Continue must restore S01E02');

merged=api.mergeContinueData({items:[{media_type:'episode',show_id:7,season:1,episode:1,source_url:'ep1'}]},history);
assert(merged.items.length===1,'Continue should keep one card per show');
assert(merged.items[0].source_url==='ep2','wrong server episode must be replaced by recovered S01E02');
assert(storage['homecinema.cache./api/continue'],'merged Continue should update offline cache');

console.log('PASS: RC3.19 converts boolean progress completion to QNAP 0/1');
console.log('PASS: RC3.19 blocks the legacy 95% auto-complete contract');
console.log('PASS: RC3.19 restores legacy S01E02 from 96% history');
console.log('PASS: RC3.19 replaces a wrong S01E01 Continue card with S01E02');
console.log('HOME_CINEMA_RC319_CONTINUE_RECOVERY_SMOKE=PASS');
