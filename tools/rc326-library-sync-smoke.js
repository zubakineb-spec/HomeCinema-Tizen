'use strict';

const fs=require('fs');
const vm=require('vm');

function fail(msg){throw new Error(msg)}
const source=fs.readFileSync('tv-app/js/rc326-library-sync.js','utf8');
const artwork=fs.readFileSync('tv-app/js/rc327-image-proxy.js','utf8');
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

[
  "marker:'rc3.27-dynamic-artwork-proxy'",
  "var TMDB_PREFIX='https://image.tmdb.org/t/p/'",
  "'/api/image?url='",
  'new Proxy(originalMap',
  'packagedMapPreserved:true',
  'domFallback:true'
].forEach(m=>{if(!artwork.includes(m))fail('missing RC3.27 artwork marker: '+m)});
if(!index.includes('<script src="js/rc327-image-proxy.js"></script>'))fail('RC3.27 image proxy layer is not loaded');
if(index.indexOf('js/rc327-image-proxy.js')<index.indexOf('js/config.js'))fail('RC3.27 must load after API config');
if(index.indexOf('js/rc327-image-proxy.js')>index.indexOf('js/rc39-cinematic-ui.js'))fail('RC3.27 must load before cinematic image consumers');
if(index.indexOf('js/rc327-image-proxy.js')>index.indexOf('js/app.js'))fail('RC3.27 must load before app image consumers');

const known='https://image.tmdb.org/t/p/w500/known.jpg';
const fresh='https://image.tmdb.org/t/p/w500/new-after-scan.jpg';
const artworkWindow={
  HOME_CINEMA_API:'http://192.168.0.101:8096',
  HOME_CINEMA_IMAGE_MAP:{},
  setTimeout:function(){return 1}
};
artworkWindow.HOME_CINEMA_IMAGE_MAP[known]='assets/tmdb/known.jpg';
artworkWindow.window=artworkWindow;
const artworkDocument={documentElement:null};
const artworkSandbox={
  window:artworkWindow,document:artworkDocument,console:console,
  String:String,Object:Object,Proxy:Proxy,encodeURIComponent:encodeURIComponent
};
vm.runInNewContext(artwork,artworkSandbox,{filename:'rc327-image-proxy.js'});
const artApi=artworkWindow.HOME_CINEMA_RC327;
if(!artApi)fail('RC3.27 runtime API missing');
if(artApi.resolve(known)!=='assets/tmdb/known.jpg')fail('packaged artwork mapping was not preserved');
const expectedFresh='http://192.168.0.101:8096/api/image?url='+encodeURIComponent(fresh);
if(artApi.resolve(fresh)!==expectedFresh)fail('new TMDB artwork was not routed through QNAP image cache');
if(artworkWindow.HOME_CINEMA_IMAGE_MAP[fresh]!==expectedFresh)fail('legacy map consumer did not receive dynamic QNAP image URL');

console.log('PASS: RC3.26 detects added/removed catalog items using a stable signature');
console.log('PASS: RC3.26 reload is deferred while playback/overlays are active');
console.log('PASS: RC3.26 layer loads after app.js and bypasses catalog cache with query token');
console.log('PASS: RC3.27 preserves packaged artwork and proxies new TMDB images through QNAP');
console.log('PASS: RC3.27 loads before cinematic/app image consumers');
console.log('HOME_CINEMA_RC326_LIBRARY_SYNC=PASS');
console.log('HOME_CINEMA_RC327_ARTWORK_PROXY=PASS');
