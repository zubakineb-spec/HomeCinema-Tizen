(function(){
'use strict';

var runtime={
  online:true,
  wasOffline:false,
  catalog:null,
  history:[],
  historyBySource:{},
  sourceMeta:{},
  currentDetail:null,
  currentDetailKey:'',
  lastSource:'',
  lastTitle:'',
  customView:'',
  savedView:null,
  sort:'recent',
  genre:'',
  filterOpen:false,
  diagnosticsOpen:false,
  nextOpen:false,
  nextTimer:null,
  nextSeconds:0,
  nextItem:null,
  skipResume:{},
  playerWasVisible:false,
  playerVisibleSince:0,
  lastPlaybackRatio:0,
  preferencesAppliedSource:'',
  enhancing:false
};
window.HOME_CINEMA_RC37_RUNTIME=runtime;
window.HOME_CINEMA_RC='rc3.7-engineering';

var baseFetch=window.fetch;
var CACHE_PREFIX='homecinema.cache.';
var PROGRESS_QUEUE='homecinema.progress.queue';
var FAVORITES_KEY='homecinema.favorites';
var SORT_KEY='homecinema.sort';
var GENRE_KEY='homecinema.genre';
var AUTOPLAY_KEY='homecinema.autoplay.next';
var SUBTITLE_SIZE_KEY='homecinema.subtitle.size';
var responseCtor=window.Response;

function $(selector,root){return (root||document).querySelector(selector)}
function $$(selector,root){return Array.prototype.slice.call((root||document).querySelectorAll(selector))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function visible(el){return !!el&&!closest(el,'.hidden')}
function apiBase(){return String(window.HOME_CINEMA_API||'').replace(/\/+$/,'')}
function safeGet(key){try{return window.localStorage.getItem(key)}catch(_){return null}}
function safeSet(key,value){try{window.localStorage.setItem(key,value);return true}catch(_){return false}}
function safeJSON(key,fallback){try{var value=safeGet(key);return value?JSON.parse(value):fallback}catch(_){return fallback}}
function escapeHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function pad2(value){value=String(value||0);return value.length<2?'0'+value:value}
function formatTime(ms){var sec=Math.max(0,Math.floor(Number(ms||0)/1000)),h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;function z(n){return n<10?'0'+n:String(n)}return h>0?(h+':'+z(m)+':'+z(s)):(z(m)+':'+z(s))}
function fakeResponse(data,status){
  status=Number(status||200);var text=JSON.stringify(data);
  return {ok:status>=200&&status<300,status:status,statusText:status===200?'OK':'OFFLINE',
    text:function(){return Promise.resolve(text)},json:function(){return Promise.resolve(JSON.parse(text)),data},
    clone:function(){return fakeResponse(data,status)}};
}

/* Chromium M56 accepts the simple response object above, but keep a real Response
 * when available for code outside app.js that expects headers/body semantics. */
function jsonResponse(data,status){
  if(typeof responseCtor==='function'){
    try{return new responseCtor(JSON.stringify(data),{status:status||200,headers:{'Content-Type':'application/json'}})}catch(_){}
  }
  return fakeResponse(data,status||200);
}

function apiPath(input){
  if(typeof input!=='string')return '';
  var ix=input.indexOf('/api/');
  return ix>=0?input.substring(ix):'';
}
function requestMethod(opts){return String(opts&&opts.method||'GET').toUpperCase()}
function cacheKey(path){return CACHE_PREFIX+path.replace(/[?#].*$/,'')}
function cached(path){var value=safeGet(cacheKey(path));if(!value)return null;try{return JSON.parse(value)}catch(_){return null}}
function cacheable(path){return path==='/api/catalog'||path==='/api/history'||path==='/api/continue'||/^\/api\/(movies|shows)\/\d+/.test(path)}
function cachePayload(path,data){if(cacheable(path))safeSet(cacheKey(path),JSON.stringify(data))}

function imageMap(){window.HOME_CINEMA_IMAGE_MAP=window.HOME_CINEMA_IMAGE_MAP||{};return window.HOME_CINEMA_IMAGE_MAP}
function localImage(raw){
  raw=String(raw||'');if(raw.indexOf('https://image.tmdb.org/')!==0)return raw;
  var map=imageMap();
  if(!map[raw])map[raw]=apiBase()+'/api/image?url='+encodeURIComponent(raw);
  return map[raw];
}
function indexImages(value){
  if(value==null)return;
  if(typeof value==='string'){if(value.indexOf('https://image.tmdb.org/')===0)localImage(value);return}
  if(Object.prototype.toString.call(value)==='[object Array]'){for(var i=0;i<value.length;i++)indexImages(value[i]);return}
  if(typeof value==='object'){for(var key in value)if(Object.prototype.hasOwnProperty.call(value,key))indexImages(value[key])}
}
function displayTitle(item){return String(item&&((item.recognized_title||'').trim()||(item.original_title||'').trim()||(item.title||'').trim())||'Без названия')}
function indexShowDetail(data){
  if(!data||!data.id)return;
  runtime.currentDetail=data;runtime.currentDetailKey='show:'+data.id;
  var episodes=data.episodes||[];
  for(var i=0;i<episodes.length;i++){
    runtime.sourceMeta[episodes[i].source_url]={showId:Number(data.id),kind:'episode',item:episodes[i],parent:data};
  }
  var extras=data.extras||[];
  for(i=0;i<extras.length;i++)runtime.sourceMeta[extras[i].source_url]={showId:Number(data.id),kind:'extra',item:extras[i],parent:data};
}
function indexApiPayload(path,data){
  indexImages(data);
  cachePayload(path,data);
  if(path==='/api/catalog'){
    runtime.catalog=data||{movies:[],shows:[]};
    window.setTimeout(function(){applyActiveFilter();decorateWatched()},80);
  }else if(path==='/api/history'){
    runtime.history=(data&&data.items)||[];rebuildHistoryIndex();decorateWatched();
  }else if(/^\/api\/shows\/\d+/.test(path)){
    indexShowDetail(data);
  }else if(/^\/api\/movies\/\d+/.test(path)){
    runtime.currentDetail=data;runtime.currentDetailKey='movie:'+Number(data&&data.id||0);
    if(data&&data.source_url)runtime.sourceMeta[data.source_url]={showId:0,kind:'movie',item:data,parent:null};
  }
}

function statusBanner(){return $('#serverStatus')}
function showStatus(text,state,autoHide){
  var el=statusBanner();if(!el)return;
  el.textContent=text;el.className='server-status '+(state||'');el.classList.remove('hidden');
  if(autoHide)window.setTimeout(function(){if(runtime.online)el.classList.add('hidden')},autoHide);
}
function markOffline(){
  if(!runtime.online)return;
  runtime.online=false;runtime.wasOffline=true;
  showStatus('NAS недоступен · используется локальный кеш','offline',0);
}
function markOnline(){
  var recovered=!runtime.online;
  runtime.online=true;
  if(recovered){showStatus('NAS снова доступен','online',2200);flushProgressQueue();refreshHistory()}
}

function offlineSearch(path){
  if(!runtime.catalog)return null;
  var q='';try{q=decodeURIComponent((path.split('q=')[1]||'').split('&')[0]||'').toLowerCase()}catch(_){}
  if(!q)return {movies:[],shows:[]};
  function match(item){return (String(item.title||'')+' '+String(item.original_title||'')).toLowerCase().indexOf(q)>=0}
  return {movies:(runtime.catalog.movies||[]).filter(match),shows:(runtime.catalog.shows||[]).filter(match)};
}
function offlinePayload(path){
  var cachedValue=cached(path);if(cachedValue)return cachedValue;
  if(path.indexOf('/api/search?')===0)return offlineSearch(path);
  if(path.indexOf('/api/progress?')===0){
    var source='';try{source=decodeURIComponent((path.split('source_url=')[1]||'').split('&')[0])}catch(_){}
    var p=runtime.historyBySource[source];
    return p?{source_url:source,position_ms:p.position_ms||0,duration_ms:p.duration_ms||0,completed:p.completed||0,updated_at:p.updated_at||''}:{source_url:source,position_ms:0,duration_ms:0,completed:0};
  }
  return null;
}
function queuedProgress(){return safeJSON(PROGRESS_QUEUE,{})||{}}
function queueProgress(opts){
  try{
    var body=JSON.parse(String(opts&&opts.body||'{}'));
    if(!body.source_url)return;
    var queue=queuedProgress();queue[body.source_url]=body;safeSet(PROGRESS_QUEUE,JSON.stringify(queue));
  }catch(_){}
}
function flushProgressQueue(){
  if(!runtime.online)return;
  var queue=queuedProgress(),keys=Object.keys(queue);if(!keys.length)return;
  var remaining={};
  var chain=Promise.resolve();
  keys.forEach(function(source){
    chain=chain.then(function(){
      return baseFetch(apiBase()+'/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(queue[source])})
        .then(function(resp){if(!resp.ok)remaining[source]=queue[source]}).catch(function(){remaining[source]=queue[source]});
    });
  });
  chain.then(function(){safeSet(PROGRESS_QUEUE,JSON.stringify(remaining))});
}

function processResponse(path,resp){
  if(!resp||!resp.ok)return Promise.resolve(resp);
  markOnline();
  if(!path||!resp.clone)return Promise.resolve(resp);
  var clone;try{clone=resp.clone()}catch(_){return Promise.resolve(resp)}
  return clone.json().then(function(data){indexApiPayload(path,data);return resp},function(){return resp});
}
function requestWithRetry(input,opts,path,attempt){
  return baseFetch(input,opts).then(function(resp){
    if(requestMethod(opts)==='GET'&&resp&&resp.status>=500&&attempt<2){
      return new Promise(function(resolve){window.setTimeout(resolve,attempt===0?450:1300)}).then(function(){return requestWithRetry(input,opts,path,attempt+1)});
    }
    return processResponse(path,resp);
  }).catch(function(error){
    if(requestMethod(opts)==='GET'&&attempt<2){
      return new Promise(function(resolve){window.setTimeout(resolve,attempt===0?450:1300)}).then(function(){return requestWithRetry(input,opts,path,attempt+1)});
    }
    markOffline();
    if(path==='/api/progress'&&requestMethod(opts)==='POST'){
      queueProgress(opts);return jsonResponse({ok:true,queued:true},202);
    }
    var value=offlinePayload(path);
    if(value!==null)return jsonResponse(value,200);
    throw error;
  });
}

if(typeof baseFetch==='function'){
  window.fetch=function(input,opts){
    var path=apiPath(input),method=requestMethod(opts);
    if(path.indexOf('/api/progress?')===0&&method==='GET'){
      var source='';try{source=decodeURIComponent((path.split('source_url=')[1]||'').split('&')[0])}catch(_){}
      if(runtime.skipResume[source]){
        delete runtime.skipResume[source];
        return Promise.resolve(jsonResponse({source_url:source,position_ms:0,duration_ms:0,completed:0},200));
      }
    }
    if(!path)return baseFetch(input,opts);
    return requestWithRetry(input,opts,path,0);
  };
}

function rebuildHistoryIndex(){
  runtime.historyBySource={};
  for(var i=0;i<runtime.history.length;i++){
    var item=runtime.history[i];if(item&&item.source_url)runtime.historyBySource[item.source_url]=item;
  }
}
function refreshHistory(){
  return window.fetch('/api/history').then(function(r){return r.ok?r.json():{items:[]}}).then(function(data){
    runtime.history=data.items||[];rebuildHistoryIndex();decorateWatched();return data;
  }).catch(function(){return {items:runtime.history}});
}
function healthCheck(){
  if(typeof baseFetch!=='function')return;
  baseFetch(apiBase()+'/api/health').then(function(resp){if(!resp.ok)throw new Error('health '+resp.status);return resp.json()}).then(function(){markOnline()},function(){markOffline()});
}

function favorites(){return safeJSON(FAVORITES_KEY,{})||{}}
function isFavorite(key){return !!favorites()[key]}
function toggleFavorite(key){
  if(!key)return false;
  var map=favorites();if(map[key])delete map[key];else map[key]=true;safeSet(FAVORITES_KEY,JSON.stringify(map));
  enhanceDetails(true);if(runtime.customView==='favorites')showCustomView('favorites');return !!map[key];
}
function itemKey(type,item){return type+':'+Number(item&&item.id||0)}
function imageFor(value){value=String(value||'');return (imageMap()[value]||localImage(value)||value)}
function compatLabel(profile){
  var value=String(profile&&profile.compatibility||'');
  if(value==='direct')return 'DIRECT';
  if(value==='dts_only')return 'DTS → AAC';
  if(value==='review')return 'CHECK';
  if(value==='direct_expected')return 'DIRECT?';
  return '';
}
function watched(source){var p=runtime.historyBySource[source];return !!(p&&Number(p.completed||0)!==0)}
function progressFor(source){return runtime.historyBySource[source]||null}
function mediaCard(item,type){
  var title=displayTitle(item),img=imageFor(item.poster_url||item.backdrop_url||''),meta=type==='show'?((item.season_count||0)+' сез. · '+(item.episode_count||0)+' сер.'):(item.year||'Фильм');
  var fav=isFavorite(itemKey(type,item))?'<span class="rc37-favorite-mark">★</span>':'';
  var done=type==='movie'&&watched(item.source_url)?'<span class="rc37-watched-mark">✓</span>':'';
  var compat=type==='movie'?compatLabel(item.media_profile):'';
  return '<button class="media-card focusable" data-card-type="'+type+'" data-id="'+item.id+'">'+
    '<div class="media-thumb" '+(img?'style="background-image:url(\''+escapeHtml(img)+'\')"':'')+'>'+fav+done+(compat?'<span class="rc37-compat">'+compat+'</span>':'')+'<span class="kind">'+(type==='show'?'СЕРИАЛ':'ФИЛЬМ')+'</span></div>'+
    '<div class="media-title">'+escapeHtml(title)+'</div><div class="media-meta">'+escapeHtml(meta)+'</div></button>';
}
function historyCard(item){
  var img=imageFor(item.image_url||item.backdrop_url||''),done=Number(item.completed||0)!==0;
  if(item.media_type==='movie'){
    return '<button class="media-card focusable" data-card-type="movie" data-id="'+item.id+'"><div class="media-thumb" '+(img?'style="background-image:url(\''+escapeHtml(img)+'\')"':'')+'>'+(done?'<span class="rc37-watched-mark">✓</span>':'')+'<span class="kind">ФИЛЬМ</span></div><div class="media-title">'+escapeHtml(item.title||'Фильм')+'</div><div class="media-meta">'+(done?'Просмотрено':Math.round(Number(item.progress_percent||0))+'%')+'</div></button>';
  }
  var subtitle=item.media_type==='episode'?('S'+pad2(item.season)+'E'+pad2(item.episode)+' · '+(item.title||'Серия')):'Доп. материал';
  return '<button class="continue-card focusable" data-play-source="'+escapeHtml(item.source_url)+'" data-play-title="'+escapeHtml(item.parent_title||item.title||'Видео')+'"><div class="continue-thumb" '+(img?'style="background-image:url(\''+escapeHtml(img)+'\')"':'')+'><div class="continue-copy"><div class="continue-title">'+escapeHtml(item.parent_title||item.title||'Видео')+'</div><div class="continue-subtitle">'+escapeHtml(subtitle)+(done?' · ✓':'')+'</div><div class="continue-progress"><span style="width:'+Number(item.progress_percent||0)+'%"></span></div></div></div></button>';
}
function sortedFiltered(list){
  var genre=String(runtime.genre||'').toLowerCase(),items=list.slice();
  if(genre)items=items.filter(function(item){return String(item.genres||'').toLowerCase().indexOf(genre)>=0});
  items.sort(function(a,b){
    if(runtime.sort==='title')return displayTitle(a).localeCompare(displayTitle(b));
    if(runtime.sort==='rating')return Number(b.rating||0)-Number(a.rating||0);
    if(runtime.sort==='year')return Number(b.year||0)-Number(a.year||0);
    return String(b.added_at||'').localeCompare(String(a.added_at||''));
  });
  return items;
}
function applyActiveFilter(){
  if(!runtime.catalog||runtime.customView)return;
  if(runtime.sort==='recent'&&!runtime.genre)return;
  var movieRow=$('#movieRow'),showRow=$('#showRow');if(!movieRow||!showRow)return;
  movieRow.innerHTML=sortedFiltered(runtime.catalog.movies||[]).map(function(x){return mediaCard(x,'movie')}).join('');
  showRow.innerHTML=sortedFiltered(runtime.catalog.shows||[]).map(function(x){return mediaCard(x,'show')}).join('');
}
function rememberStandardView(){
  if(runtime.savedView)return;
  runtime.savedView={
    movieHTML:$('#movieRow')?$('#movieRow').innerHTML:'',showHTML:$('#showRow')?$('#showRow').innerHTML:'',continueHTML:$('#continueRow')?$('#continueRow').innerHTML:'',
    movieTitle:$('#movieSection h2')?$('#movieSection h2').textContent:'Фильмы',heroHidden:$('#hero')?$('#hero').classList.contains('hidden'):false,
    continueHidden:$('#continueSection')?$('#continueSection').classList.contains('hidden'):true,showHidden:$('#showSection')?$('#showSection').classList.contains('hidden'):false
  };
}
function restoreStandardView(){
  if(!runtime.savedView)return;
  if($('#movieRow'))$('#movieRow').innerHTML=runtime.savedView.movieHTML;
  if($('#showRow'))$('#showRow').innerHTML=runtime.savedView.showHTML;
  if($('#continueRow'))$('#continueRow').innerHTML=runtime.savedView.continueHTML;
  if($('#movieSection h2'))$('#movieSection h2').textContent=runtime.savedView.movieTitle;
  if($('#hero'))$('#hero').classList.toggle('hidden',runtime.savedView.heroHidden);
  if($('#continueSection'))$('#continueSection').classList.toggle('hidden',runtime.savedView.continueHidden);
  if($('#showSection'))$('#showSection').classList.toggle('hidden',runtime.savedView.showHidden);
  if($('#movieSection'))$('#movieSection').classList.remove('hidden');
  runtime.savedView=null;runtime.customView='';
  applyActiveFilter();
  var home=$('.nav-item[data-view="home"]');if(home)window.setTimeout(function(){try{home.click()}catch(_){}},0);
}
function showCustomView(kind){
  if(!runtime.catalog)return;
  rememberStandardView();runtime.customView=kind;
  var hero=$('#hero'),cont=$('#continueSection'),movies=$('#movieSection'),shows=$('#showSection'),row=$('#movieRow'),title=$('#movieSection h2');
  if(hero)hero.classList.add('hidden');if(cont)cont.classList.add('hidden');if(shows)shows.classList.add('hidden');if(movies)movies.classList.remove('hidden');
  var html='';
  if(kind==='history'){
    if(title)title.textContent='История просмотра';html=runtime.history.map(historyCard).join('');
  }else{
    if(title)title.textContent='Избранное';var fav=favorites();
    (runtime.catalog.movies||[]).forEach(function(item){if(fav[itemKey('movie',item)])html+=mediaCard(item,'movie')});
    (runtime.catalog.shows||[]).forEach(function(item){if(fav[itemKey('show',item)])html+=mediaCard(item,'show')});
  }
  if(row)row.innerHTML=html||'<div class="rc37-empty">Здесь пока пусто</div>';
  focusFirst('#movieRow .focusable');
}

function overlayFocusables(root){return $$('.rc37-focusable',root).filter(function(el){return visible(el)&&!el.disabled})}
function focusFirst(selector){var el=$(selector);if(el){$$('.focused').forEach(function(x){x.classList.remove('focused')});el.classList.add('focused');try{el.focus()}catch(_){}}}
function moveOwnFocus(root,delta){
  var list=overlayFocusables(root);if(!list.length)list=$$('.focusable',root).filter(visible);if(!list.length)return;
  var active=document.activeElement,ix=list.indexOf(active);if(ix<0)ix=0;else ix=Math.max(0,Math.min(list.length-1,ix+delta));
  $$('.focused',root).forEach(function(x){x.classList.remove('focused')});list[ix].classList.add('focused');try{list[ix].focus()}catch(_){}
}

function genreValues(){
  var values={},out=[];if(!runtime.catalog)return out;
  (runtime.catalog.movies||[]).concat(runtime.catalog.shows||[]).forEach(function(item){String(item.genres||'').split(',').forEach(function(g){g=g.replace(/^\s+|\s+$/g,'');if(g&&!values[g]){values[g]=true;out.push(g)}})});
  out.sort();return out.slice(0,18);
}
function openFilter(){
  var overlay=$('#rc37FilterOverlay');if(!overlay)return;runtime.filterOpen=true;
  var genres=genreValues(),box=$('#rc37GenreOptions');
  if(box)box.innerHTML='<button class="rc37-chip rc37-focusable '+(!runtime.genre?'selected':'')+'" data-rc37-genre="">Все жанры</button>'+genres.map(function(g){return '<button class="rc37-chip rc37-focusable '+(runtime.genre===g?'selected':'')+'" data-rc37-genre="'+escapeHtml(g)+'">'+escapeHtml(g)+'</button>'}).join('');
  overlay.classList.remove('hidden');focusFirst('#rc37FilterOverlay .rc37-focusable');
}
function closeFilter(){runtime.filterOpen=false;var overlay=$('#rc37FilterOverlay');if(overlay)overlay.classList.add('hidden')}
function applyFilterAndClose(){safeSet(SORT_KEY,runtime.sort);safeSet(GENRE_KEY,runtime.genre);closeFilter();applyActiveFilter();showStatus('Фильтр применён','online',1200)}

function openDiagnostics(){
  runtime.diagnosticsOpen=true;var overlay=$('#rc37DiagnosticsOverlay');if(!overlay)return;overlay.classList.remove('hidden');
  var endpoint=$('#rc37Endpoint');if(endpoint)endpoint.value=apiBase();
  refreshDiagnostics();focusFirst('#rc37DiagnosticsOverlay .rc37-focusable');
}
function closeDiagnostics(){runtime.diagnosticsOpen=false;var overlay=$('#rc37DiagnosticsOverlay');if(overlay)overlay.classList.add('hidden')}
function diagnosticRow(label,value){return '<div class="rc37-diag-row"><span>'+escapeHtml(label)+'</span><b>'+escapeHtml(value)+'</b></div>'}
function refreshDiagnostics(){
  var target=$('#rc37DiagnosticsBody');if(!target)return;target.innerHTML=diagnosticRow('Статус NAS',runtime.online?'ONLINE':'OFFLINE')+diagnosticRow('Endpoint',apiBase())+diagnosticRow('TV build','0.3.18 / RC3.7 engineering');
  window.fetch('/api/diagnostics').then(function(r){return r.json()}).then(function(data){
    var av='n/a';try{if(window.webapis&&webapis.avplay)av=webapis.avplay.getState()}catch(_){}
    target.innerHTML=diagnosticRow('Статус NAS',runtime.online?'ONLINE':'OFFLINE')+diagnosticRow('Endpoint',apiBase())+diagnosticRow('Backend',data.version||'?')+diagnosticRow('Runtime',data.runtime||'?')+
      diagnosticRow('Фильмы',data.movies||0)+diagnosticRow('Сериалы',data.shows||0)+diagnosticRow('Видео-профили',data.profiled_files||0)+diagnosticRow('Image cache',data.image_cache_entries||0)+
      diagnosticRow('FFprobe',data.ffprobe?'есть':'нет')+diagnosticRow('FFmpeg',data.ffmpeg?'есть':'нет')+diagnosticRow('AVPlay',av)+diagnosticRow('Текущий файл',runtime.lastSource||'—');
  }).catch(function(){target.innerHTML+=diagnosticRow('Backend diagnostics','недоступна')});
  var autoplay=$('#rc37Autoplay');if(autoplay)autoplay.textContent='Автоследующая серия: '+(autoplayEnabled()?'ВКЛ':'ВЫКЛ');
  var sub=$('#rc37SubtitleSize');if(sub)sub.textContent='Размер субтитров: '+subtitleSize()+' px';
}

function autoplayEnabled(){return safeGet(AUTOPLAY_KEY)!=='0'}
function toggleAutoplay(){safeSet(AUTOPLAY_KEY,autoplayEnabled()?'0':'1');refreshDiagnostics()}
function subtitleSize(){var n=Number(safeGet(SUBTITLE_SIZE_KEY)||44);return [36,44,52,60].indexOf(n)>=0?n:44}
function applySubtitleSize(){var sub=$('#subtitleText');if(sub)sub.style.fontSize=subtitleSize()+'px';var label=$('#rc37SubtitleSizeControl small');if(label)label.textContent=subtitleSize()+' px'}
function cycleSubtitleSize(){var sizes=[36,44,52,60],current=subtitleSize(),ix=sizes.indexOf(current);safeSet(SUBTITLE_SIZE_KEY,String(sizes[(ix+1)%sizes.length]));applySubtitleSize();refreshDiagnostics()}

function showNext(item){
  if(!item||!item.source_url)return;runtime.nextItem=item;runtime.nextOpen=true;runtime.nextSeconds=7;
  var overlay=$('#rc37NextOverlay');if(!overlay)return;
  $('#rc37NextTitle').textContent=(item.parent_title||'Следующая серия')+' · S'+pad2(item.season)+'E'+pad2(item.episode);
  $('#rc37NextSubtitle').textContent=item.title||'Следующая серия';
  var play=$('#rc37NextPlay');play.setAttribute('data-play-source',item.source_url);play.setAttribute('data-play-title',(item.parent_title||'Сериал')+' — '+(item.title||('Серия '+item.episode)));
  overlay.classList.remove('hidden');updateNextCountdown();focusFirst('#rc37NextPlay');
  if(runtime.nextTimer){clearInterval(runtime.nextTimer);runtime.nextTimer=null}
  if(autoplayEnabled())runtime.nextTimer=setInterval(function(){runtime.nextSeconds--;updateNextCountdown();if(runtime.nextSeconds<=0){clearInterval(runtime.nextTimer);runtime.nextTimer=null;play.click()}},1000);
}
function updateNextCountdown(){var el=$('#rc37NextCountdown');if(el)el.textContent=autoplayEnabled()?('Автозапуск через '+runtime.nextSeconds+' сек'):'Автозапуск выключен'}
function closeNext(){runtime.nextOpen=false;runtime.nextItem=null;if(runtime.nextTimer){clearInterval(runtime.nextTimer);runtime.nextTimer=null}var overlay=$('#rc37NextOverlay');if(overlay)overlay.classList.add('hidden')}
function requestNext(source){
  window.fetch('/api/next?source_url='+encodeURIComponent(source)).then(function(r){return r.json()}).then(function(data){if(data&&data.item)showNext(data.item)}).catch(function(){});
}

function preferenceKey(showId,type){return 'homecinema.track.'+Number(showId||0)+'.'+type}
function saveTrackPreference(button){
  var meta=runtime.sourceMeta[runtime.lastSource];if(!meta||!meta.showId)return;
  if(button.hasAttribute('data-suboff')){safeSet(preferenceKey(meta.showId,'subtitle'),JSON.stringify({off:true}));return}
  var type=String(button.getAttribute('data-track')||'').toLowerCase();if(type!=='audio'&&type!=='text')return;
  var label=$('.setting-main',button);safeSet(preferenceKey(meta.showId,type==='audio'?'audio':'subtitle'),JSON.stringify({off:false,index:Number(button.getAttribute('data-index')||-1),label:label?label.textContent:''}));
}
function applyTrackPreferences(){
  var player=$('#player');if(!visible(player)||!runtime.lastSource||runtime.preferencesAppliedSource===runtime.lastSource)return;
  if(Date.now()-runtime.playerVisibleSince<1100)return;
  var meta=runtime.sourceMeta[runtime.lastSource];if(!meta||!meta.showId)return;
  if(!window.webapis||!webapis.avplay)return;
  var state='';try{state=webapis.avplay.getState()}catch(_){return}if(state!=='PLAYING')return;
  var total=[];try{total=webapis.avplay.getTotalTrackInfo()||[]}catch(_){return}
  var audio=safeJSON(preferenceKey(meta.showId,'audio'),null),subtitle=safeJSON(preferenceKey(meta.showId,'subtitle'),null);
  try{
    if(audio&&Number(audio.index)>=0){for(var i=0;i<total.length;i++)if(total[i].type==='AUDIO'&&Number(total[i].index)===Number(audio.index)){webapis.avplay.setSelectTrack('AUDIO',Number(audio.index));break}}
    if(subtitle){if(subtitle.off)webapis.avplay.setSilentSubtitle(true);else if(Number(subtitle.index)>=0){webapis.avplay.setSilentSubtitle(false);for(i=0;i<total.length;i++)if(total[i].type==='TEXT'&&Number(total[i].index)===Number(subtitle.index)){webapis.avplay.setSelectTrack('TEXT',Number(subtitle.index));break}}}
  }catch(_){}
  runtime.preferencesAppliedSource=runtime.lastSource;
}

function enhanceDetails(force){
  var details=$('#details');if(!details||!visible(details)||runtime.enhancing)return;
  runtime.enhancing=true;
  try{
    var actions=$('.details-actions',details),key=runtime.currentDetailKey;
    if(actions&&key&&!$('#rc37FavoriteButton',details)){
      var fav=document.createElement('button');fav.id='rc37FavoriteButton';fav.className='focusable secondary';fav.setAttribute('data-rc37-favorite',key);fav.textContent=isFavorite(key)?'★ В избранном':'☆ В избранное';actions.appendChild(fav);
    }else if(force&&$('#rc37FavoriteButton',details))$('#rc37FavoriteButton',details).textContent=isFavorite(key)?'★ В избранном':'☆ В избранное';
    var play=$('#detailPlay',details);
    if(play){
      var source=play.getAttribute('data-play-source')||'',p=progressFor(source);
      if(p&&Number(p.completed||0)===0&&Number(p.position_ms||0)>15000){
        play.textContent='▶ Продолжить · '+formatTime(p.position_ms);
        if(actions&&!$('#rc37StartOver',details)){
          var start=document.createElement('button');start.id='rc37StartOver';start.className='focusable secondary';start.setAttribute('data-rc37-start-over',source);start.textContent='↺ С начала';actions.insertBefore(start,$('#detailBack',details));
        }
      }
      var detail=runtime.currentDetail,profile=detail&&detail.media_profile,label=compatLabel(profile),meta=$('.details-meta',details);
      if(label&&meta&&!$('.rc37-detail-compat',meta)){var badge=document.createElement('span');badge.className='rc37-detail-compat '+String(profile.compatibility||'');badge.textContent=label;meta.appendChild(badge)}
    }
    $$('.episode-card[data-play-source]',details).forEach(function(card){
      var source=card.getAttribute('data-play-source'),p=progressFor(source),meta=runtime.sourceMeta[source],profile=meta&&meta.item&&meta.item.media_profile;
      card.classList.toggle('rc37-watched-card',!!(p&&Number(p.completed||0)!==0));
      var badge=$('.rc37-episode-status',card);if(!badge){badge=document.createElement('span');badge.className='rc37-episode-status';card.appendChild(badge)}
      var parts=[];if(p&&Number(p.completed||0)!==0)parts.push('✓ просмотрено');else if(p&&Number(p.progress_percent||0)>0)parts.push(Math.round(Number(p.progress_percent))+'%');var c=compatLabel(profile);if(c)parts.push(c);badge.textContent=parts.join(' · ');
    });
  }finally{runtime.enhancing=false}
}
function decorateWatched(){enhanceDetails(false)}

function ensureUI(){
  var app=$('#app');if(!app)return;
  if(!$('#serverStatus')){var status=document.createElement('div');status.id='serverStatus';status.className='server-status hidden';app.appendChild(status)}
  var nav=$('#topbar .nav-row');
  if(nav&&!$('#rc37HistoryNav')){
    var history=document.createElement('button');history.id='rc37HistoryNav';history.className='nav-item focusable';history.setAttribute('data-rc37-view','history');history.textContent='История';
    var favoritesNav=document.createElement('button');favoritesNav.id='rc37FavoritesNav';favoritesNav.className='nav-item focusable';favoritesNav.setAttribute('data-rc37-view','favorites');favoritesNav.textContent='Избранное';
    var filter=document.createElement('button');filter.id='rc37FilterNav';filter.className='nav-item focusable';filter.setAttribute('data-rc37-action','filter');filter.textContent='Фильтр';
    var about=$('.nav-item[data-view="about"]',nav);nav.insertBefore(history,about);nav.insertBefore(favoritesNav,about);nav.insertBefore(filter,about);
  }
  var aboutCard=$('#aboutOverlay .about-card');
  if(aboutCard&&!$('#rc37DiagnosticsButton')){var diag=document.createElement('button');diag.id='rc37DiagnosticsButton';diag.className='primary about-back';diag.setAttribute('data-rc37-action','diagnostics');diag.textContent='Диагностика и настройки';aboutCard.insertBefore(diag,$('#aboutBack',aboutCard))}
  if(!$('#rc37DiagnosticsOverlay')){
    var diagnostics=document.createElement('div');diagnostics.id='rc37DiagnosticsOverlay';diagnostics.className='overlay rc37-overlay hidden';diagnostics.innerHTML='<div class="rc37-sheet"><div class="eyebrow">HOME CINEMA RC3.7</div><h1>Диагностика</h1><div id="rc37DiagnosticsBody" class="rc37-diagnostics"></div><label class="rc37-endpoint-label">NAS endpoint</label><input id="rc37Endpoint" class="rc37-input rc37-focusable" type="text"/><div class="rc37-actions"><button class="primary rc37-focusable" data-rc37-action="save-endpoint">Сохранить endpoint</button><button id="rc37Autoplay" class="secondary rc37-focusable" data-rc37-action="autoplay"></button><button id="rc37SubtitleSize" class="secondary rc37-focusable" data-rc37-action="subtitle-size"></button><button class="secondary rc37-focusable" data-rc37-action="diagnostics-refresh">Обновить</button><button class="secondary rc37-focusable" data-rc37-action="diagnostics-close">Назад</button></div></div>';app.appendChild(diagnostics)
  }
  if(!$('#rc37FilterOverlay')){
    var overlay=document.createElement('div');overlay.id='rc37FilterOverlay';overlay.className='overlay rc37-overlay hidden';overlay.innerHTML='<div class="rc37-sheet"><div class="eyebrow">МЕДИАТЕКА</div><h1>Сортировка и фильтр</h1><div class="rc37-filter-title">Сортировка</div><div class="rc37-chip-row"><button class="rc37-chip rc37-focusable" data-rc37-sort="recent">Новые</button><button class="rc37-chip rc37-focusable" data-rc37-sort="title">Название</button><button class="rc37-chip rc37-focusable" data-rc37-sort="rating">Рейтинг</button><button class="rc37-chip rc37-focusable" data-rc37-sort="year">Год</button></div><div class="rc37-filter-title">Жанр</div><div id="rc37GenreOptions" class="rc37-chip-row"></div><div class="rc37-actions"><button class="primary rc37-focusable" data-rc37-action="filter-apply">Применить</button><button class="secondary rc37-focusable" data-rc37-action="filter-reset">Сбросить</button><button class="secondary rc37-focusable" data-rc37-action="filter-close">Назад</button></div></div>';app.appendChild(overlay)
  }
  if(!$('#rc37NextOverlay')){
    var next=document.createElement('div');next.id='rc37NextOverlay';next.className='overlay rc37-next-overlay hidden';next.innerHTML='<div class="rc37-next-card"><div class="eyebrow">СЛЕДУЮЩАЯ СЕРИЯ</div><h2 id="rc37NextTitle"></h2><div id="rc37NextSubtitle" class="rc37-next-subtitle"></div><div id="rc37NextCountdown" class="rc37-next-countdown"></div><div class="rc37-actions"><button id="rc37NextPlay" class="primary rc37-focusable">▶ Смотреть</button><button class="secondary rc37-focusable" data-rc37-action="next-close">Отмена</button></div></div>';app.appendChild(next)
  }
  var controls=$('#playerControls');
  if(controls&&!$('#rc37SubtitleSizeControl')){var size=document.createElement('button');size.id='rc37SubtitleSizeControl';size.className='player-control player-control-setting player-focusable';size.setAttribute('data-rc37-action','subtitle-size');size.innerHTML='<span class="control-icon">Aa</span><span class="control-copy"><b>Размер</b><small>'+subtitleSize()+' px</small></span>';controls.appendChild(size)}
  applySubtitleSize();
}

function handleOwnKey(root,code){
  if(code===10009||code===27)return 'back';
  if(code===13)return 'ok';
  if(code===37||code===38)return 'prev';
  if(code===39||code===40)return 'next';
  return '';
}
window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0),action='';
  if(runtime.nextOpen){action=handleOwnKey($('#rc37NextOverlay'),code);if(!action)return;consume(e);if(action==='back')closeNext();else if(action==='prev')moveOwnFocus($('#rc37NextOverlay'),-1);else if(action==='next')moveOwnFocus($('#rc37NextOverlay'),1);else if(action==='ok'&&document.activeElement)document.activeElement.click();return false}
  if(runtime.diagnosticsOpen){action=handleOwnKey($('#rc37DiagnosticsOverlay'),code);if(!action)return;var active=document.activeElement;if(active&&active.id==='rc37Endpoint'&&code!==10009&&code!==27&&code!==13)return;consume(e);if(action==='back')closeDiagnostics();else if(action==='prev')moveOwnFocus($('#rc37DiagnosticsOverlay'),-1);else if(action==='next')moveOwnFocus($('#rc37DiagnosticsOverlay'),1);else if(action==='ok'&&active)active.click();return false}
  if(runtime.filterOpen){action=handleOwnKey($('#rc37FilterOverlay'),code);if(!action)return;consume(e);if(action==='back')closeFilter();else if(action==='prev')moveOwnFocus($('#rc37FilterOverlay'),-1);else if(action==='next')moveOwnFocus($('#rc37FilterOverlay'),1);else if(action==='ok'&&document.activeElement)document.activeElement.click();return false}
  if(runtime.customView){
    action=handleOwnKey($('#movieSection'),code);if(!action)return;consume(e);
    if(action==='back'){restoreStandardView();return false}
    var list=$$('#movieRow .focusable');if(!list.length)return false;var ix=list.indexOf(document.activeElement);if(ix<0)ix=0;if(action==='prev')ix=Math.max(0,ix-1);if(action==='next')ix=Math.min(list.length-1,ix+1);if(action==='ok'){var target=document.activeElement;if(target&&target.click)target.click();return false}$$('#movieRow .focused').forEach(function(x){x.classList.remove('focused')});list[ix].classList.add('focused');try{list[ix].focus()}catch(_){}return false;
  }
},true);

document.addEventListener('click',function(e){
  var target=e.target,custom=closest(target,'[data-rc37-view]'),actionEl=closest(target,'[data-rc37-action]');
  if(custom){consume(e);showCustomView(custom.getAttribute('data-rc37-view'));return false}
  if(closest(target,'[data-view]')&&runtime.customView){restoreStandardView()}
  if(actionEl){
    var action=actionEl.getAttribute('data-rc37-action');
    if(action==='filter'){consume(e);openFilter();return false}
    if(action==='diagnostics'){consume(e);var about=$('#aboutOverlay');if(about)about.classList.add('hidden');openDiagnostics();return false}
    if(action==='diagnostics-close'){consume(e);closeDiagnostics();return false}
    if(action==='diagnostics-refresh'){consume(e);refreshDiagnostics();return false}
    if(action==='autoplay'){consume(e);toggleAutoplay();return false}
    if(action==='subtitle-size'){consume(e);cycleSubtitleSize();return false}
    if(action==='save-endpoint'){
      consume(e);var input=$('#rc37Endpoint'),value=input&&input.value;if(window.HOME_CINEMA_SET_API&&window.HOME_CINEMA_SET_API(value)){showStatus('Endpoint сохранён · перезапуск','online',1000);window.setTimeout(function(){window.location.reload()},700)}else showStatus('Некорректный endpoint','offline',2200);return false
    }
    if(action==='filter-apply'){consume(e);applyFilterAndClose();return false}
    if(action==='filter-reset'){consume(e);runtime.sort='recent';runtime.genre='';safeSet(SORT_KEY,'recent');safeSet(GENRE_KEY,'');closeFilter();if(runtime.catalog){$('#movieRow').innerHTML=(runtime.catalog.movies||[]).map(function(x){return mediaCard(x,'movie')}).join('');$('#showRow').innerHTML=(runtime.catalog.shows||[]).map(function(x){return mediaCard(x,'show')}).join('')}return false}
    if(action==='filter-close'){consume(e);closeFilter();return false}
    if(action==='next-close'){consume(e);closeNext();return false}
  }
  var sort=closest(target,'[data-rc37-sort]');if(sort){consume(e);runtime.sort=sort.getAttribute('data-rc37-sort');$$('[data-rc37-sort]').forEach(function(x){x.classList.toggle('selected',x===sort)});return false}
  var genre=closest(target,'[data-rc37-genre]');if(genre){consume(e);runtime.genre=genre.getAttribute('data-rc37-genre');$$('[data-rc37-genre]').forEach(function(x){x.classList.toggle('selected',x===genre)});return false}
  var fav=closest(target,'[data-rc37-favorite]');if(fav){consume(e);toggleFavorite(fav.getAttribute('data-rc37-favorite'));return false}
  var start=closest(target,'[data-rc37-start-over]');if(start){consume(e);var source=start.getAttribute('data-rc37-start-over'),play=$('#detailPlay');runtime.skipResume[source]=true;if(play)window.setTimeout(function(){play.click()},0);return false}
  var track=closest(target,'.player-setting-option[data-track],.player-setting-option[data-suboff]');if(track)saveTrackPreference(track);
  var card=closest(target,'[data-card-type]');if(card)runtime.currentDetailKey=card.getAttribute('data-card-type')+':'+Number(card.getAttribute('data-id')||0);
  var playSource=closest(target,'[data-play-source]');if(playSource){runtime.lastSource=playSource.getAttribute('data-play-source')||'';runtime.lastTitle=playSource.getAttribute('data-play-title')||'';runtime.preferencesAppliedSource='';runtime.lastPlaybackRatio=0;if(runtime.nextOpen)closeNext();if(runtime.customView)window.setTimeout(restoreStandardView,20)}
},true);

function pollPlayer(){
  var player=$('#player'),isVisible=visible(player),now=Date.now();
  if(isVisible&&!runtime.playerWasVisible){runtime.playerVisibleSince=now;runtime.lastPlaybackRatio=0;runtime.preferencesAppliedSource=''}
  if(isVisible&&window.webapis&&webapis.avplay){try{var d=Number(webapis.avplay.getDuration()||0),p=Number(webapis.avplay.getCurrentTime()||0);if(d>0)runtime.lastPlaybackRatio=p/d}catch(_){}applyTrackPreferences()}
  if(!isVisible&&runtime.playerWasVisible){
    var completed=runtime.lastPlaybackRatio>=0.995,source=runtime.lastSource;runtime.lastPlaybackRatio=0;runtime.preferencesAppliedSource='';refreshHistory();if(completed&&source)window.setTimeout(function(){requestNext(source)},350)
  }
  runtime.playerWasVisible=isVisible;
}
function poll(){ensureUI();enhanceDetails(false);pollPlayer()}

runtime.sort=safeGet(SORT_KEY)||'recent';runtime.genre=safeGet(GENRE_KEY)||'';
ensureUI();refreshHistory();healthCheck();flushProgressQueue();
window.setInterval(healthCheck,12000);
window.setInterval(poll,450);
window.setInterval(refreshHistory,30000);
})();
