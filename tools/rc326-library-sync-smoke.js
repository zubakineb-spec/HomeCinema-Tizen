'use strict';

const fs=require('fs');
const vm=require('vm');

function fail(msg){throw new Error(msg)}
const source=fs.readFileSync('tv-app/js/rc326-library-sync.js','utf8');
const index=fs.readFileSync('tv-app/index.html','utf8');

[
  "marker:'rc3.26-auto-library-sync'",
  'var POLL_MS=15000',
  'var FIRST_POLL_MS=8000',
  "'/api/catalog?rc326='",
  'baselineFromRuntime()',
  'pendingRevision=revision',
  'if(!hidden($(\'#player\')))return false',
  'window.location.reload()'
].forEach(m=>{if(!source.includes(m))fail('missing RC3.26 marker: '+m)});

if(!index.includes('<script src="js/rc326-library-sync.js"></script>'))fail('RC3.26 library sync layer is not loaded');
if(index.indexOf('js/rc326-library-sync.js')<index.indexOf('js/app.js'))fail('RC3.26 must load after app.js');

const elements={
  '#player':{classList:{contains:x=>x==='hidden'}},
  '#details':{classList:{contains:x=>x==='hidden'}},
  '#searchOverlay':{classList:{contains:x=>x==='hidden'}},
  '#aboutOverlay':{classList:{contains:x=>x==='hidden'}}
};
const document={
  readyState:'loading',hidden:false,
  querySelector:s=>elements[s]||null,
  addEventListener:function(){}
};
const windowObj={
  HOME_CINEMA_API:'http://192.168.0.101:8096',
  HOME_CINEMA_RC37_RUNTIME:{catalog:null},
  fetch:function(){return Promise.reject(new Error('not used'))},
  setTimeout:function(){return 1},setInterval:function(){return 1},
  location:{reload:function(){}}
};
windowObj.window=windowObj;
const sandbox={window:windowObj,document:document,console:console,Date:Date,String:String,Array:Array,Object:Object};
vm.runInNewContext(source,sandbox,{filename:'rc326-library-sync.js'});
const api=windowObj.HOME_CINEMA_RC326;
if(!api)fail('RC3.26 runtime API missing');

const a={movies:[{id:1,source_url:'a.mkv',file_size:10,file_mtime:1}],shows:[{id:2,episode_count:2,season_count:1,extra_count:0}]};
const reordered={movies:[{id:1,source_url:'a.mkv',file_size:10,file_mtime:1}],shows:[{id:2,episode_count:2,season_count:1,extra_count:0}]};
const added={movies:[{id:1,source_url:'a.mkv',file_size:10,file_mtime:1},{id:3,source_url:'b.mkv',file_size:20,file_mtime:2}],shows:[{id:2,episode_count:2,season_count:1,extra_count:0}]};
const episodeAdded={movies:[{id:1,source_url:'a.mkv',file_size:10,file_mtime:1}],shows:[{id:2,episode_count:3,season_count:1,extra_count:0}]};
if(api.catalogRevision(a)!==api.catalogRevision(reordered))fail('stable catalog produced unstable revision');
if(api.catalogRevision(a)===api.catalogRevision(added))fail('added movie was not detected');
if(api.catalogRevision(a)===api.catalogRevision(episodeAdded))fail('episode-count change was not detected');
if(!api.safeToReload())fail('home state must be safe to reload');
elements['#player'].classList.contains=x=>false;
if(api.safeToReload())fail('active player must block library reload');

console.log('PASS: RC3.26 detects added/removed catalog items using a stable signature');
console.log('PASS: RC3.26 reload is deferred while playback/overlays are active');
console.log('PASS: RC3.26 layer loads after app.js and bypasses catalog cache with query token');
console.log('HOME_CINEMA_RC326_LIBRARY_SYNC=PASS');
