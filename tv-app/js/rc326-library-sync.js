(function(){
'use strict';

/* RC3.26: keep the Samsung catalog synchronized with the QNAP filesystem.
 * Backend reconciles the media tree independently. The TV polls a cache-busted
 * catalog snapshot and reloads only when the media set actually changes and no
 * video/details/search overlay is active.
 */
var POLL_MS=15000;
var FIRST_POLL_MS=8000;
var baseline='';
var pendingRevision='';
var pollBusy=false;
var reloadIssued=false;
var timer=null;

function $(s){try{return document.querySelector(s)}catch(_){return null}}
function hidden(el){return !el||el.classList.contains('hidden')}
function apiBase(){return String(window.HOME_CINEMA_API||'').replace(/\/+$/,'')}
function stable(value){return String(value==null?'':value)}

function catalogRevision(catalog){
  catalog=catalog||{};
  var parts=[];
  var movies=catalog.movies||[];
  var shows=catalog.shows||[];
  for(var i=0;i<movies.length;i++){
    var m=movies[i]||{};
    parts.push('m|'+stable(m.id)+'|'+stable(m.source_url)+'|'+stable(m.file_size)+'|'+stable(m.file_mtime));
  }
  for(i=0;i<shows.length;i++){
    var s=shows[i]||{};
    parts.push('s|'+stable(s.id)+'|'+stable(s.episode_count)+'|'+stable(s.season_count)+'|'+stable(s.extra_count));
  }
  parts.sort();
  return parts.join('\n');
}

function baselineFromRuntime(){
  if(baseline)return;
  var rt=window.HOME_CINEMA_RC37_RUNTIME||{};
  if(rt.catalog)baseline=catalogRevision(rt.catalog);
}

function safeToReload(){
  if(!hidden($('#player')))return false;
  if(!hidden($('#details')))return false;
  if(!hidden($('#searchOverlay')))return false;
  if(!hidden($('#aboutOverlay')))return false;
  return true;
}

function applyPending(){
  if(!pendingRevision||reloadIssued||!safeToReload())return;
  reloadIssued=true;
  try{window.location.reload()}catch(_){reloadIssued=false}
}

function fetchFreshCatalog(){
  if(pollBusy||reloadIssued)return;
  pollBusy=true;
  baselineFromRuntime();
  var url=apiBase()+'/api/catalog?rc326='+Date.now();
  window.fetch(url,{method:'GET'}).then(function(resp){
    if(!resp||!resp.ok)throw new Error('catalog '+(resp&&resp.status));
    return resp.json();
  }).then(function(data){
    var revision=catalogRevision(data);
    if(!baseline){baseline=revision;return}
    if(revision!==baseline){
      pendingRevision=revision;
      applyPending();
    }
  }).catch(function(){
    // Existing RC3.7 offline/cache behavior remains the source of truth.
  }).then(function(){pollBusy=false},function(){pollBusy=false});
}

function tick(){
  baselineFromRuntime();
  if(pendingRevision){applyPending();return}
  fetchFreshCatalog();
}

function start(){
  if(timer!==null)return;
  window.setTimeout(function(){tick();timer=window.setInterval(tick,POLL_MS)},FIRST_POLL_MS);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)window.setTimeout(tick,500)},false);
}

window.HOME_CINEMA_RC326={
  marker:'rc3.26-auto-library-sync',
  pollMs:POLL_MS,
  firstPollMs:FIRST_POLL_MS,
  catalogRevision:catalogRevision,
  safeToReload:safeToReload
};
window.HOME_CINEMA_RC='rc3.26-auto-library-sync';

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,false);else start();
})();
