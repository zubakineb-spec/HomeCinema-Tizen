(function(){
'use strict';

var state={
  catalog:{movies:[],shows:[]},
  continueItems:[],
  mode:'home',
  view:'home',
  heroItem:null,
  current:null,
  selectedSeason:null,
  focusables:[],
  focus:0,
  tracksOpen:false,
  playerMenuOpen:false,
  playerPanel:null,
  playerMenuTimer:null,
  playerFocusIndex:0,
  player:null,
  playerToken:0,
  playerTimer:null,
  saveTimer:null,
  seekBusy:false,
  pendingStop:null,
  lifecycleSuspended:false,
  pendingVisibility:false,
  postStartPending:null,
  searchTimer:null
};
var $=function(s,root){return (root||document).querySelector(s)};
var $$=function(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))};
var API_BASE=(location.protocol==='http:'||location.protocol==='https:')?'':(window.HOME_CINEMA_API||'');

function api(path,opts){
  return fetch(API_BASE+path,opts).then(function(r){
    if(!r.ok){return r.text().then(function(t){throw new Error(t||('HTTP '+r.status))})}
    return r.json();
  });
}
function esc(v){return String(v||'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function visible(el){return !!el&&!closest(el,'.hidden')}
function imageUrl(v){v=String(v||'');if(!v)return '';var m=window.HOME_CINEMA_IMAGE_MAP||{};return m[v]||v}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}return false}
function toast(msg,ms){var e=$('#toast');e.textContent=msg;e.classList.remove('hidden');clearTimeout(e.__timer);e.__timer=setTimeout(function(){e.classList.add('hidden')},ms||2800)}
function pad2(v){v=String(v||0);return v.length<2?'0'+v:v}
function episodeCode(e){return 'S'+pad2(e.season)+'E'+pad2(e.episode)}
function cleanFallbackTitle(value){
  var v=String(value||'').replace(/\.[A-Za-z0-9]{2,5}$/,'');
  v=v.replace(/[._]+/g,' ').replace(/\b(2160p|1080p|720p|WEB[- .]?DL|WEBRip|BluRay|BDRip|HDRip|DVDRip|x264|x265|HEVC|AVC|AAC|DTS|AC3|EAC3|DDP|REMUX)\b/ig,' ');
  v=v.replace(/\[[^\]]+\]|\([^)]*(2160|1080|720|x264|x265|hevc|webrip|bluray)[^)]*\)/ig,' ');
  v=v.replace(/\s{2,}/g,' ').replace(/^\s+|\s+$/g,'');
  return v||'Без названия';
}
function displayTitle(item){
  if(!item)return '';
  var titleMap=window.HOME_CINEMA_TITLE_MAP||{};
  var tmdbKey=Number(item.tmdb_id||0)>0?'tmdb:'+Number(item.tmdb_id):'';
  if(tmdbKey&&String(titleMap[tmdbKey]||'').trim())return String(titleMap[tmdbKey]).trim();
  if(String(item.recognized_title||'').trim())return String(item.recognized_title).trim();
  if(Number(item.tmdb_id||0)>0&&String(item.original_title||'').trim())return String(item.original_title).trim();
  return cleanFallbackTitle(item.title||'Без названия');
}
function episodeTitle(show,e){
  var base=displayTitle(show);
  return base+' — '+String(e.title||('Серия '+e.episode));
}

function mediaCard(item,type){
  var title=displayTitle(item);
  var img=imageUrl(item.poster_url||item.backdrop_url||'');
  var meta=type==='show'?((item.season_count||0)+' сез. · '+(item.episode_count||0)+' сер.'):(item.year||'Фильм');
  return '<button class="media-card focusable" data-card-type="'+type+'" data-id="'+item.id+'">'+
    '<div class="media-thumb" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'><span class="kind">'+(type==='show'?'СЕРИАЛ':'ФИЛЬМ')+'</span></div>'+
    '<div class="media-title">'+esc(title)+'</div><div class="media-meta">'+esc(meta)+'</div></button>';
}
function continueCard(item){
  var isEp=item.media_type==='episode'||item.media_type==='extra';
  var title=isEp?(item.parent_title||item.title):(item.title||'Фильм');
  var sub=item.media_type==='episode'?(episodeCode(item)+' · '+(item.title||'Серия')):(item.media_type==='extra'?'Доп. материал':'Продолжить');
  var img=imageUrl(item.image_url||item.backdrop_url||'');
  return '<button class="continue-card focusable" data-play-source="'+esc(item.source_url)+'" data-play-title="'+esc(title)+'">'+
    '<div class="continue-thumb" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'><div class="continue-copy">'+
    '<div class="continue-title">'+esc(title)+'</div><div class="continue-subtitle">'+esc(sub)+'</div>'+
    '<div class="continue-progress"><span style="width:'+Number(item.progress_percent||0)+'%"></span></div></div></div></button>';
}

function focusRoot(){
  if(state.mode==='details')return $('#details');
  if(state.mode==='search')return $('#searchOverlay');
  if(state.mode==='player')return null;
  return $('#app');
}
function modeFocusables(){
  var root=focusRoot();if(!root)return [];
  return $$('.focusable',root).filter(function(el){
    if(!visible(el)||el.disabled)return false;
    var r=el.getBoundingClientRect();
    return r.width>0&&r.height>0;
  });
}
function rowName(el){
  if(!el)return '';
  var own=el.getAttribute('data-nav-row');if(own)return own;
  var row=closest(el,'[data-nav-row]');
  return row?row.getAttribute('data-nav-row'):'';
}
function rowOrder(){
  if(state.mode==='details')return ['detail-actions','seasons','episodes','extras'];
  if(state.mode==='search')return ['search-input','search-results'];
  return ['top','hero','continue','movies','shows'];
}
function elementsInRow(name){return state.focusables.filter(function(el){return rowName(el)===name})}
function firstVisibleShelf(){
  var all=['continue','movies','shows'];
  for(var i=0;i<all.length;i++){var s=$('[data-shelf="'+all[i]+'"]');if(s&&visible(s))return all[i]}
  return '';
}
function showShelf(name){
  if(state.mode!=='home')return;
  var target=name;
  if(['continue','movies','shows'].indexOf(target)<0)target=firstVisibleShelf();
  var section=$('[data-shelf="'+target+'"]');
  if(!section||!visible(section))return;
  $$('.shelf').forEach(function(x){x.classList.toggle('active-shelf',x===section)});
}
function ensureVisible(el){
  var rail=closest(el,'.rail')||closest(el,'.episode-rail')||closest(el,'.season-rail')||closest(el,'.search-results');
  if(rail){
    var rr=rail.getBoundingClientRect(),er=el.getBoundingClientRect();
    if(er.left<rr.left+8)rail.scrollLeft-=Math.max(0,(rr.left+8-er.left));
    else if(er.right>rr.right-40)rail.scrollLeft+=Math.max(0,(er.right-(rr.right-40)));
  }
  if(state.mode==='home')showShelf(rowName(el));
}
function rebuildFocus(preferred){
  state.focusables=modeFocusables();
  if(preferred){var ix=state.focusables.indexOf(preferred);if(ix>=0)state.focus=ix}
  if(state.focus<0)state.focus=0;
  if(state.focus>=state.focusables.length)state.focus=Math.max(0,state.focusables.length-1);
  $$('.focusable').forEach(function(x){x.classList.remove('focused')});
  var el=state.focusables[state.focus];
  if(el){
    if(state.mode==='home'&&['continue','movies','shows'].indexOf(rowName(el))>=0)showShelf(rowName(el));
    el.classList.add('focused');try{el.focus()}catch(_){}ensureVisible(el);
    if(state.mode==='home'){
      var card=closest(el,'[data-card-type]');
      if(card){var item=findItem(card.dataset.cardType,Number(card.dataset.id));if(item)setHero(item)}
    }
  }
}
function focusElement(el){
  if(!el)return;
  state.focusables=modeFocusables();
  var i=state.focusables.indexOf(el);
  if(i>=0){state.focus=i;rebuildFocus(el)}
}
function move(dir){
  if(!state.focusables.length)rebuildFocus();
  var cur=state.focusables[state.focus];if(!cur)return;
  var rn=rowName(cur),order=rowOrder(),rows=[];
  order.forEach(function(n){if(elementsInRow(n).length)rows.push(n)});
  var currentRow=rows.indexOf(rn),rowEls=elementsInRow(rn),pos=rowEls.indexOf(cur),target=null;
  if(dir==='left'&&pos>0)target=rowEls[pos-1];
  else if(dir==='right'&&pos>=0&&pos<rowEls.length-1)target=rowEls[pos+1];
  else if(dir==='up'||dir==='down'){
    var ri=currentRow+(dir==='down'?1:-1);
    if(ri>=0&&ri<rows.length){
      var candidates=elementsInRow(rows[ri]);
      if(candidates.length){
        var cr=cur.getBoundingClientRect(),cx=(cr.left+cr.right)/2,best=99999;
        candidates.forEach(function(x){
          var r=x.getBoundingClientRect(),d=Math.abs(((r.left+r.right)/2)-cx);
          if(d<best){best=d;target=x}
        });
      }
    }
  }
  if(target)focusElement(target);
}
function activate(){
  var el=state.focusables[state.focus];if(!el)return;
  if(el.tagName==='INPUT'){try{el.focus()}catch(_){}}
  else{try{el.click()}catch(e){console.error('activate click',e)}}
}

function setHero(item){
  if(!item)return;
  state.heroItem=item;
  $('#heroTitle').textContent=displayTitle(item)||'Домашний кинотеатр';
  $('#heroMeta').textContent=[item.year,item.rating?'★ '+Number(item.rating).toFixed(1):null,item.genres].filter(Boolean).join(' · ');
  $('#heroOverview').textContent=item.overview||'Фильмы и сериалы из вашей медиатеки.';
  var img=imageUrl(item.backdrop_url||item.poster_url||'');
  $('#hero').style.backgroundImage=img?'url(\''+img+'\')':'';
}
function findItem(type,id){
  var arr=type==='movie'?state.catalog.movies:state.catalog.shows;
  for(var i=0;i<arr.length;i++)if(Number(arr[i].id)===Number(id))return arr[i];
  return null;
}
function loadContinue(){
  return api('/api/continue').then(function(x){
    state.continueItems=x.items||[];
    $('#continueRow').innerHTML=state.continueItems.map(continueCard).join('');
    $('#continueSection').classList.toggle('hidden',state.view!=='home'||!state.continueItems.length);
  }).catch(function(){state.continueItems=[];$('#continueSection').classList.add('hidden')});
}
function load(){
  return api('/api/catalog').then(function(c){
    state.catalog=c||{movies:[],shows:[]};
    $('#movieRow').innerHTML=(state.catalog.movies||[]).map(function(x){return mediaCard(x,'movie')}).join('');
    $('#showRow').innerHTML=(state.catalog.shows||[]).map(function(x){return mediaCard(x,'show')}).join('');
    var first=(state.catalog.movies||[])[0]||(state.catalog.shows||[])[0];
    setHero(first);
    $('#empty').classList.toggle('hidden',!!first);
    return loadContinue();
  }).then(function(){
    state.mode='home';state.focus=0;showShelf(firstVisibleShelf());rebuildFocus($('.nav-item.active')||$('#heroPlay'));
  }).catch(function(e){console.error(e);toast('Сервер медиатеки недоступен',5000)});
}
function setView(view){
  state.view=view;
  $$('.nav-item').forEach(function(x){x.classList.toggle('active',x.dataset.view===view)});
  if(view==='search'){openSearch();return}
  closeSearch(false);
  $('#movieSection').classList.toggle('hidden',view==='shows');
  $('#showSection').classList.toggle('hidden',view==='movies');
  $('#continueSection').classList.toggle('hidden',view!=='home'||!state.continueItems.length);
  state.mode='home';state.focus=0;showShelf(firstVisibleShelf());rebuildFocus($('.nav-item.active'));
}

function seasonButtons(item){
  return (item.seasons||[]).map(function(s){
    return '<button class="season-tab focusable '+(Number(s.number)===Number(state.selectedSeason)?'selected':'')+'" data-season="'+s.number+'">Сезон '+s.number+'</button>';
  }).join('');
}
function selectedSeason(item){
  var ss=item.seasons||[];
  for(var i=0;i<ss.length;i++)if(Number(ss[i].number)===Number(state.selectedSeason))return ss[i];
  return null;
}
function episodeCards(item){
  var s=selectedSeason(item);
  if(!s||!s.episodes||!s.episodes.length)return '<div class="episode-meta">В этом сезоне серии не найдены</div>';
  return s.episodes.map(function(e){
    var img=imageUrl(e.still_url||item.backdrop_url||item.poster_url||'');
    return '<button class="episode-card focusable" data-play-source="'+esc(e.source_url)+'" data-play-title="'+esc(episodeTitle(item,e))+'">'+
      '<div class="episode-thumb" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'></div>'+
      '<div class="episode-title">'+episodeCode(e)+' · '+esc(e.title||('Серия '+e.episode))+'</div>'+
      '<div class="episode-meta">'+esc([e.runtime?e.runtime+' мин':'',e.air_date||''].filter(Boolean).join(' · '))+'</div></button>';
  }).join('');
}
function extraCards(item){
  var a=item.extras||[];
  return a.map(function(e){
    var img=imageUrl(e.still_url||item.backdrop_url||'');
    return '<button class="episode-card focusable" data-play-source="'+esc(e.source_url)+'" data-play-title="'+esc(displayTitle(item)+' — '+(e.title||'Доп. материал'))+'">'+
      '<div class="episode-thumb" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'></div>'+
      '<div class="episode-title">'+esc(e.title||'Доп. материал')+'</div><div class="episode-meta">Доп. материал</div></button>';
  }).join('');
}
function renderSeriesArea(item,preferEpisode){
  var area=$('#seriesArea');if(!area)return;
  var extras=extraCards(item);
  area.innerHTML='<div class="series-label">Сезоны и серии</div>'+
    '<div class="season-rail nav-row" data-nav-row="seasons">'+seasonButtons(item)+'</div>'+
    '<div class="episode-rail nav-row" data-nav-row="episodes">'+episodeCards(item)+'</div>'+
    (extras?'<div class="extra-label">Дополнительные материалы</div><div class="episode-rail nav-row" data-nav-row="extras">'+extras+'</div>':'');
  rebuildFocus();
  if(preferEpisode)focusElement($('.episode-card',area)||$('.season-tab',area));
}
function firstShowSource(item){
  var s=(item.seasons||[])[0];
  return s&&s.episodes&&s.episodes[0]?s.episodes[0]:null;
}
function openDetails(type,id){
  return api(type==='movie'?'/api/movies/'+id:'/api/shows/'+id).then(function(item){
    state.mode='details';state.current=item;
    if(type==='show')state.selectedSeason=item.seasons&&item.seasons.length?item.seasons[0].number:null;
    var title=displayTitle(item);
    var img=imageUrl(item.backdrop_url||item.poster_url||'');
    var first=type==='show'?firstShowSource(item):null;
    var source=type==='movie'?item.source_url:(first?first.source_url:'');
    var playTitle=type==='movie'?title:(first?episodeTitle(item,first):title);
    var html='<div class="details-bg" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'></div>'+
      '<div class="details-shade"></div><div class="details-content"><div class="eyebrow">'+(type==='show'?'СЕРИАЛ':'ФИЛЬМ')+'</div>'+
      '<h1 class="details-title">'+esc(title)+'</h1><div class="details-meta">'+esc([item.year,item.rating?'★ '+Number(item.rating).toFixed(1):null,item.genres].filter(Boolean).join(' · '))+'</div>'+
      '<div class="details-overview">'+esc(item.overview||'Описание отсутствует')+'</div>'+
      '<div class="details-actions nav-row" data-nav-row="detail-actions">'+
      (source?'<button id="detailPlay" class="focusable primary" data-play-source="'+esc(source)+'" data-play-title="'+esc(playTitle)+'">▶ Смотреть</button>':'')+
      '<button id="detailBack" class="focusable secondary" data-action="details-back">Назад</button></div></div>'+
      (type==='show'?'<div id="seriesArea" class="series-area"></div>':'');
    $('#details').innerHTML=html;$('#details').classList.remove('hidden');
    if(type==='show')renderSeriesArea(item,false);
    state.focus=0;rebuildFocus($('#detailPlay')||$('.season-tab',$('#details'))||$('#detailBack'));
  }).catch(function(e){console.error(e);toast('Не удалось открыть карточку')});
}
function closeDetails(){
  if(state.player)return;
  $('#details').classList.add('hidden');$('#details').innerHTML='';
  state.current=null;state.mode='home';state.focus=0;showShelf(firstVisibleShelf());rebuildFocus();
}

function openSearch(){
  state.mode='search';$('#searchOverlay').classList.remove('hidden');state.focus=0;rebuildFocus($('#searchInput'));try{$('#searchInput').focus()}catch(_){}
}
function closeSearch(reset){
  $('#searchOverlay').classList.add('hidden');$('#searchResults').innerHTML='';
  if(reset!==false){state.view='home';$$('.nav-item').forEach(function(x){x.classList.toggle('active',x.dataset.view==='home')});state.mode='home'}
}
function runSearch(){
  var q=$('#searchInput').value.trim();
  if(!q){$('#searchResults').innerHTML='';rebuildFocus($('#searchInput'));return}
  api('/api/search?q='+encodeURIComponent(q)).then(function(r){
    $('#searchResults').innerHTML=(r.movies||[]).map(function(x){return mediaCard(x,'movie')}).join('')+(r.shows||[]).map(function(x){return mediaCard(x,'show')}).join('');
    rebuildFocus($('#searchInput'));
  }).catch(function(){toast('Ошибка поиска')});
}

function avAvailable(){return typeof webapis!=='undefined'&&webapis.avplay}
function clearPlayerTimer(){if(state.playerTimer){clearTimeout(state.playerTimer);state.playerTimer=null}}
function clearSaveTimer(){if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=null}}
function resetLifecycleState(){state.lifecycleSuspended=false;state.pendingVisibility=false;state.postStartPending=null}
function createAvObject(){
  var host=$('#avHost');if(!host)return;
  host.innerHTML='';
  var obj=document.createElement('object');
  obj.id='avplay';
  obj.type='application/avplayer';
  obj.setAttribute('tabindex','-1');
  host.appendChild(obj);
}
function destroyAvObject(){var host=$('#avHost');if(host)host.innerHTML=''}
function closeAv(){
  if(!avAvailable()){destroyAvObject();return}
  var p=webapis.avplay;
  try{var s=p.getState();if(s==='PLAYING'||s==='PAUSED'||s==='READY')p.stop()}catch(_){}
  try{p.close()}catch(_){}
  destroyAvObject();
}
function restorePlayerScreen(){
  $('#player').classList.add('hidden');
  $('#playerBoot').classList.remove('hidden');
  $('#playerChrome').classList.add('hidden');
  $('#playerSettings').classList.add('hidden');
  $('#subtitleText').textContent='';
  clearPlayerMenuTimer();
  state.playerMenuOpen=false;state.playerPanel=null;state.playerFocusIndex=0;
  destroyAvObject();
}
function failPlayback(message,token){
  if(token&&(!state.player||token!==state.player.token))return;
  clearPlayerTimer();clearSaveTimer();state.seekBusy=false;state.pendingStop=null;resetLifecycleState();closeAv();restorePlayerScreen();
  state.tracksOpen=false;state.player=null;state.mode=state.current?'details':'home';
  toast(message||'Видео не запустилось',5000);
  setTimeout(function(){rebuildFocus($('#detailPlay')||null)},40);
}
function runPostStart(token,url,p){
  if(!state.player||state.player.token!==token)return;
  if(document.hidden||state.lifecycleSuspended){state.postStartPending={token:token,url:url};return}
  state.postStartPending=null;
  selectCompatibleAudio();
  restoreProgress(url,p,token,function(){
    if(!state.player||state.player.token!==token||state.lifecycleSuspended)return;
    refreshPlayerTrackSummary();
    showPlayerMenu('#playerToggleButton');
  });
}
function handlePlayerVisibility(){
  if(!state.player||state.player.phase!=='playing'||!avAvailable())return;
  if(state.seekBusy){state.pendingVisibility=true;return}
  state.pendingVisibility=false;
  var p=webapis.avplay;
  if(document.hidden){
    if(state.lifecycleSuspended)return;
    try{
      var s=p.getState();
      if(s==='READY'||s==='PLAYING'||s==='PAUSED'){p.suspend();state.lifecycleSuspended=true;hidePlayerMenu()}
    }catch(e){console.warn('AVPlay suspend failed',e)}
    return;
  }
  if(!state.lifecycleSuspended)return;
  try{
    p.restore();
    state.lifecycleSuspended=false;
    var pending=state.postStartPending;
    if(pending&&state.player&&pending.token===state.player.token)runPostStart(pending.token,pending.url,p);
    else if(state.player)showPlayerMenu('#playerToggleButton');
  }catch(e){console.warn('AVPlay restore failed',e)}
}
function beginPlayback(token,url){
  if(!state.player||state.player.token!==token)return;
  if(!avAvailable()){failPlayback('Samsung AVPlay недоступен',token);return}
  try{
    closeAv();
    createAvObject();
    var p=webapis.avplay;
    state.player.phase='opening';
    $('#playerBootText').textContent='Открываю видео…';
    p.open(url);
    p.setDisplayRect(0,0,1920,1080);
    try{p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX')}catch(_){}
    p.setListener({
      onbufferingstart:function(){if(state.player&&state.player.token===token)$('#playerBootText').textContent='Буферизация…'},
      onbufferingcomplete:function(){},
      oncurrentplaytime:function(t){if(state.player&&state.player.token===token){var d=0;try{d=p.getDuration()}catch(_){}updateProgress(t,d)}},
      onstreamcompleted:function(){if(state.player&&state.player.token===token)stopPlayer(true)},
      onsubtitlechange:function(duration,text){
        if(!state.player||state.player.token!==token)return;
        $('#subtitleText').textContent=text||'';
        if(text)setTimeout(function(){if(state.player&&state.player.token===token&&$('#subtitleText').textContent===text)$('#subtitleText').textContent=''},Number(duration)||2500);
      },
      onerror:function(e){console.error('AVPlay error',e);failPlayback('Ошибка AVPlay: '+String(e),token)}
    });
    state.player.phase='preparing';
    $('#playerBootText').textContent='Подготовка видео…';
    clearPlayerTimer();
    state.playerTimer=setTimeout(function(){failPlayback('Видео не ответило за 12 секунд',token)},12000);
    p.prepareAsync(function(){
      if(!state.player||state.player.token!==token)return;
      clearPlayerTimer();
      try{p.setDisplayRect(0,0,1920,1080)}catch(_){}
      $('#playerBootText').textContent='Запускаю…';
      try{p.play()}catch(e){console.error(e);failPlayback('Не удалось начать воспроизведение',token);return}
      state.player.phase='playing';
      $('#playerBoot').classList.add('hidden');
      if(document.hidden){handlePlayerVisibility();state.postStartPending={token:token,url:url};return}
      setTimeout(function(){runPostStart(token,url,p)},420);
    },function(e){console.error('AVPlay prepare error',e);failPlayback('Не удалось подготовить видео',token)});
  }catch(e){console.error('AVPlay open error',e);failPlayback('Не удалось открыть видео',token)}
}
function startPlayback(url,title){
  if(!url){toast('У файла нет адреса воспроизведения');return}
  if(state.player){toast('Видео уже запускается');return}
  clearSaveTimer();state.seekBusy=false;state.pendingStop=null;resetLifecycleState();
  state.playerToken++;
  var token=state.playerToken;
  state.mode='player';state.tracksOpen=false;
  state.player={token:token,url:url,title:title||'Видео',phase:'boot',subtitleOff:true,lastPosition:0,lastDuration:0};
  $('#playerTitle').textContent=title||'Видео';$('#playerProgress').style.width='0%';
  $('#playerCurrentTime').textContent='00:00';$('#playerDurationTime').textContent='00:00';
  $('#playerBootText').textContent='Запуск видео…';
  $('#player').classList.remove('hidden');$('#playerBoot').classList.remove('hidden');$('#playerChrome').classList.add('hidden');$('#playerSettings').classList.add('hidden');$('#subtitleText').textContent='';
  state.playerMenuOpen=false;state.playerPanel=null;state.playerFocusIndex=0;
  try{window.focus();document.body.focus()}catch(_){}
  setTimeout(function(){beginPlayback(token,url)},90);
}
function restoreProgress(url,p,token,onDone){
  if(!state.player||state.player.token!==token)return;
  var finished=false;
  state.seekBusy=true;
  function finish(error){
    if(finished)return;
    finished=true;state.seekBusy=false;
    if(error)console.warn('Restore progress seek failed',error);
    var pending=state.pendingStop;state.pendingStop=null;
    if(pending){stopPlayer(pending.completed);return}
    if(state.pendingVisibility)handlePlayerVisibility();
    if(onDone)try{onDone()}catch(_){}
  }
  api('/api/progress?source_url='+encodeURIComponent(url)).then(function(x){
    if(!state.player||state.player.token!==token){finish();return}
    if(x.position_ms>15000&&x.completed!==1){
      try{p.seekTo(x.position_ms,function(){finish()},function(e){finish(e)});return}
      catch(e){finish(e);return}
    }
    finish();
  }).catch(function(e){finish(e)});
}
function saveProgress(pos,dur,completed,player){
  var pl=player||state.player;if(!pl)return Promise.resolve(false);
  return fetch(API_BASE+'/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_url:pl.url,position_ms:Math.round(pos||0),duration_ms:Math.round(dur||0),completed:!!completed})})
    .then(function(r){return !!(r&&r.ok)})
    .catch(function(){return false});
}
function formatPlayerTime(ms){
  var sec=Math.max(0,Math.floor(Number(ms||0)/1000)),h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  function z(n){return n<10?'0'+n:String(n)}
  return h>0?(h+':'+z(m)+':'+z(s)):(z(m)+':'+z(s));
}
function updateProgress(pos,dur){
  var pct=dur?Math.max(0,Math.min(100,pos/dur*100)):0;
  $('#playerProgress').style.width=pct+'%';
  $('#playerCurrentTime').textContent=formatPlayerTime(pos);
  $('#playerDurationTime').textContent=formatPlayerTime(dur);
  if(state.player){state.player.lastPosition=Number(pos||0);state.player.lastDuration=Number(dur||0)}
  if(!state.saveTimer&&state.player){
    var token=state.player.token;
    state.saveTimer=setTimeout(function(){
      state.saveTimer=null;
      var pl=state.player;
      if(!pl||pl.token!==token)return;
      var p=Number(pl.lastPosition||0),d=Number(pl.lastDuration||0);
      saveProgress(p,d,d>0&&(p/d)>0.95,pl);
    },5000);
  }
}
function stopPlayer(completed){
  if(!state.player)return;
  if(state.seekBusy){state.pendingStop={completed:!!completed};return}
  var pl=state.player,pos=0,dur=0;clearPlayerTimer();clearSaveTimer();state.pendingStop=null;resetLifecycleState();
  try{var p=webapis.avplay;pos=p.getCurrentTime();dur=p.getDuration()}catch(_){}
  if(pos<=0&&Number(pl.lastPosition||0)>0)pos=Number(pl.lastPosition);
  if(dur<=0&&Number(pl.lastDuration||0)>0)dur=Number(pl.lastDuration);
  var completedNow=!!completed||(dur>0&&pos/dur>0.95);
  closeAv();restorePlayerScreen();
  state.player=null;state.tracksOpen=false;state.playerMenuOpen=false;state.playerPanel=null;state.mode=state.current?'details':'home';
  saveProgress(pos,dur,completedNow,pl).then(function(){return loadContinue()}).then(function(){rebuildFocus($('#detailPlay')||null)});
}
function syncToggleButton(){
  if(!state.player||!avAvailable()||state.lifecycleSuspended)return;
  var st='';try{st=webapis.avplay.getState()}catch(_){}
  var paused=st==='PAUSED';
  $('#playerToggleIcon').textContent=paused?'▶':'Ⅱ';
  $('#playerToggleLabel').textContent=paused?'Продолжить':'Пауза';
  $('#playerStateText').textContent=paused?'Пауза':'Воспроизведение';
}
function playerToggle(){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy||state.lifecycleSuspended)return;
  try{var p=webapis.avplay,st=p.getState();if(st==='PLAYING')p.pause();else if(st==='PAUSED')p.play();syncToggleButton();showPlayerMenu('#playerToggleButton')}catch(e){toast('Пауза недоступна')}
}
function seek(delta,onDone){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy||state.lifecycleSuspended)return;
  state.seekBusy=true;
  var finished=false;
  function finish(ok,error){
    if(finished)return;
    finished=true;state.seekBusy=false;
    if(error)console.warn('AVPlay seek failed',error);
    var pending=state.pendingStop;state.pendingStop=null;
    if(pending){stopPlayer(pending.completed);return}
    if(state.pendingVisibility)handlePlayerVisibility();
    if(onDone)try{onDone(ok)}catch(_){}
  }
  try{
    var success=function(){finish(true,null)};
    var failure=function(e){finish(false,e)};
    if(delta>0)webapis.avplay.jumpForward(delta,success,failure);
    else webapis.avplay.jumpBackward(Math.abs(delta),success,failure);
  }catch(e){finish(false,e)}
}
function parseExtra(v){if(v&&typeof v==='object')return v;try{return JSON.parse(v||'{}')}catch(_){return {}}}
function isDtsTrack(i){var x=parseExtra(i&&i.extra_info),c=String(x.fourCC||'').toUpperCase();return c.indexOf('DTS')>=0||c.indexOf('DCA')>=0}
function selectCompatibleAudio(){
  if(!state.player||state.player.phase!=='playing'||state.lifecycleSuspended||!avAvailable())return;
  try{
    var p=webapis.avplay,total=p.getTotalTrackInfo()||[],current=p.getCurrentStreamInfo()||[],selected=null,i;
    for(i=0;i<current.length;i++){if(current[i].type==='AUDIO'){selected=current[i];break}}
    if(selected&&!isDtsTrack(selected))return;
    for(i=0;i<total.length;i++){if(total[i].type==='AUDIO'&&!isDtsTrack(total[i])){p.setSelectTrack('AUDIO',Number(total[i].index));return}}
  }catch(e){console.warn('Compatible audio selection',e)}
}
function languageName(v){
  var x=String(v||'').toLowerCase();
  if(x==='ru'||x==='rus'||x==='russian')return 'Русский';
  if(x==='en'||x==='eng'||x==='english')return 'Английский';
  if(x==='de'||x==='deu'||x==='ger'||x==='german')return 'Немецкий';
  if(x==='fr'||x==='fra'||x==='fre'||x==='french')return 'Французский';
  if(x==='es'||x==='spa'||x==='spanish')return 'Испанский';
  if(x==='it'||x==='ita'||x==='italian')return 'Итальянский';
  return x?String(v).toUpperCase():'Дорожка';
}
function trackData(i){
  var x=parseExtra(i.extra_info),lang=x.language||x.track_lang||x.lang||'';
  return {name:languageName(lang),meta:[x.channels?x.channels+' ch':'',x.fourCC||''].filter(Boolean).join(' · ')};
}
function trackLabel(i){var d=trackData(i);return d.name+(d.meta?' · '+d.meta:'')}
function clearPlayerMenuTimer(){if(state.playerMenuTimer){clearTimeout(state.playerMenuTimer);state.playerMenuTimer=null}}
function schedulePlayerMenuHide(){
  clearPlayerMenuTimer();
  if(!state.playerMenuOpen||state.playerPanel)return;
  state.playerMenuTimer=setTimeout(function(){hidePlayerMenu()},7000);
}
function playerFocusableList(){
  var root=state.playerPanel?$('#playerSettings'):$('#playerChrome');
  if(!root)return [];
  return $$('.player-focusable',root).filter(function(el){return visible(el)&&!el.disabled});
}
function focusPlayer(el){
  var list=playerFocusableList();
  $$('.player-focusable').forEach(function(x){x.classList.remove('focused')});
  if(!list.length)return;
  var ix=el?list.indexOf(el):-1;if(ix<0)ix=Math.max(0,Math.min(state.playerFocusIndex,list.length-1));
  state.playerFocusIndex=ix;var target=list[ix];target.classList.add('focused');try{target.focus()}catch(_){}
  schedulePlayerMenuHide();
}
function showPlayerMenu(preferredSelector){
  if(!state.player||state.player.phase!=='playing'||state.lifecycleSuspended)return;
  state.playerMenuOpen=true;state.playerPanel=null;
  $('#playerSettings').classList.add('hidden');$('#playerChrome').classList.remove('hidden');
  syncToggleButton();refreshPlayerTrackSummary();
  var preferred=preferredSelector?$(preferredSelector,$('#playerChrome')):null;
  if(!preferred)preferred=$('#playerToggleButton');
  focusPlayer(preferred);schedulePlayerMenuHide();
}
function hidePlayerMenu(){
  if(state.playerPanel){closePlayerPanel();return}
  clearPlayerMenuTimer();state.playerMenuOpen=false;state.playerFocusIndex=0;
  $('#playerChrome').classList.add('hidden');$$('.player-focusable').forEach(function(x){x.classList.remove('focused')});
}
function getTrackSnapshot(){
  var out={total:[],current:[],selected:{}};
  if(!state.player||state.player.phase!=='playing'||state.lifecycleSuspended||!avAvailable())return out;
  try{out.total=webapis.avplay.getTotalTrackInfo()||[];out.current=webapis.avplay.getCurrentStreamInfo()||[]}catch(_){}
  out.current.forEach(function(x){out.selected[x.type]=Number(x.index)});return out;
}
function refreshPlayerTrackSummary(){
  var snap=getTrackSnapshot(),audio=snap.total.filter(function(x){return x.type==='AUDIO'}),text=snap.total.filter(function(x){return x.type==='TEXT'}),aLabel='Авто',sLabel='Выкл.',i;
  for(i=0;i<audio.length;i++)if(Number(audio[i].index)===snap.selected.AUDIO){aLabel=trackData(audio[i]).name;break}
  if(state.player&&state.player.subtitleOff===false){for(i=0;i<text.length;i++)if(Number(text[i].index)===snap.selected.TEXT){sLabel=trackData(text[i]).name;break}}
  $('#playerAudioLabel').textContent=aLabel;$('#playerSubtitleLabel').textContent=sLabel;
}
function settingOption(track,type,selected){
  var d=trackData(track);
  return '<button class="player-setting-option player-focusable '+(selected?'selected':'')+'" data-track="'+type+'" data-index="'+track.index+'"><span class="setting-main">'+esc(d.name)+'</span><span class="setting-meta">'+esc(d.meta||((type==='AUDIO')?'Аудиодорожка':'Субтитры'))+'</span></button>';
}
function openPlayerPanel(kind){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy||state.lifecycleSuspended)return;
  clearPlayerMenuTimer();state.playerMenuOpen=true;state.playerPanel=kind;state.playerFocusIndex=0;
  $('#playerChrome').classList.remove('hidden');$('#playerSettings').classList.remove('hidden');
  var snap=getTrackSnapshot(),html='',title=kind==='audio'?'Аудио':'Субтитры';
  if(kind==='audio'){
    var audio=snap.total.filter(function(x){return x.type==='AUDIO'});
    html=audio.map(function(x){return settingOption(x,'AUDIO',Number(x.index)===snap.selected.AUDIO)}).join('');
    if(!html)html='<div class="player-settings-empty">Дополнительных аудиодорожек нет</div>';
  }else{
    var text=snap.total.filter(function(x){return x.type==='TEXT'});
    html='<button class="player-setting-option player-focusable '+((!state.player||state.player.subtitleOff!==false)?'selected':'')+'" data-suboff="1"><span class="setting-main">Выкл.</span><span class="setting-meta">Не показывать субтитры</span></button>'+text.map(function(x){return settingOption(x,'TEXT',state.player&&state.player.subtitleOff===false&&Number(x.index)===snap.selected.TEXT)}).join('');
  }
  $('#playerSettingsKicker').textContent='НАСТРОЙКИ ПЛЕЕРА';$('#playerSettingsTitle').textContent=title;$('#playerSettingsList').innerHTML=html;
  focusPlayer($('.player-setting-option.selected',$('#playerSettingsList'))||$('.player-setting-option',$('#playerSettingsList')));
}
function closePlayerPanel(){
  if(!state.playerPanel)return;
  var old=state.playerPanel;state.playerPanel=null;state.playerFocusIndex=0;$('#playerSettings').classList.add('hidden');
  refreshPlayerTrackSummary();focusPlayer(old==='audio'?$('#playerAudioButton'):$('#playerSubtitleButton'));schedulePlayerMenuHide();
}
function selectPlayerTrack(type,index,button){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy||state.lifecycleSuspended||!avAvailable())return;
  try{
    var token=state.player.token,p=webapis.avplay,wasPaused=false;try{wasPaused=p.getState()==='PAUSED'}catch(_){}
    if(type==='AUDIO'&&wasPaused){p.play()}
    if(type==='TEXT'){p.setSilentSubtitle(false);state.player.subtitleOff=false}
    p.setSelectTrack(type,Number(index));
    if(type==='AUDIO'&&wasPaused){setTimeout(function(){if(!state.player||state.player.token!==token||state.lifecycleSuspended)return;try{if(p.getState()==='PLAYING')p.pause();syncToggleButton()}catch(_){}},120)}
    if(button){var d=button.querySelector('.setting-main');toast((type==='AUDIO'?'Аудио: ':'Субтитры: ')+(d?d.textContent:button.textContent),1800)}
    setTimeout(function(){if(!state.player||state.player.token!==token||state.lifecycleSuspended)return;refreshPlayerTrackSummary();openPlayerPanel(type==='AUDIO'?'audio':'subtitles')},180);
  }catch(e){console.warn('Track switch failed',e);toast('Не удалось переключить дорожку',3000)}
}
function disableSubtitles(){
  if(!state.player||state.seekBusy||state.lifecycleSuspended)return;
  try{webapis.avplay.setSilentSubtitle(true);state.player.subtitleOff=true;$('#subtitleText').textContent='';refreshPlayerTrackSummary();openPlayerPanel('subtitles');toast('Субтитры выключены',1600)}catch(e){toast('Не удалось выключить субтитры')}
}
function playerMove(dir){
  var list=playerFocusableList();if(!list.length)return;
  var cur=list[state.playerFocusIndex]||list[0],next=cur;
  if(state.playerPanel){
    if(dir==='up')next=list[Math.max(0,state.playerFocusIndex-1)];
    else if(dir==='down')next=list[Math.min(list.length-1,state.playerFocusIndex+1)];
  }else{
    if(dir==='left')next=list[Math.max(0,state.playerFocusIndex-1)];
    else if(dir==='right')next=list[Math.min(list.length-1,state.playerFocusIndex+1)];
  }
  focusPlayer(next);
}
function activatePlayer(){var list=playerFocusableList(),el=list[state.playerFocusIndex];if(el)try{el.click()}catch(_){} }


function handleClick(e){
  var playerAction=closest(e.target,'[data-player-action]');
  if(playerAction&&state.player&&state.player.phase==='playing'){
    var action=playerAction.dataset.playerAction;
    if(action==='toggle')playerToggle();else if(action==='rewind'){seek(-10000,function(){showPlayerMenu('[data-player-action=\"rewind\"]')})}else if(action==='forward'){seek(10000,function(){showPlayerMenu('[data-player-action=\"forward\"]')})}
    return;
  }
  var playerPanel=closest(e.target,'[data-player-panel]');if(playerPanel&&state.player&&state.player.phase==='playing'){openPlayerPanel(playerPanel.dataset.playerPanel);return}
  var settingTrack=closest(e.target,'.player-setting-option[data-track]');if(settingTrack&&state.player){selectPlayerTrack(settingTrack.dataset.track,settingTrack.dataset.index,settingTrack);return}
  if(closest(e.target,'.player-setting-option[data-suboff]')&&state.player){disableSubtitles();return}
  var focusable=closest(e.target,'.focusable');if(focusable)focusElement(focusable);
  var nav=closest(e.target,'[data-view]');if(nav){setView(nav.dataset.view);return}
  var card=closest(e.target,'[data-card-type]');if(card){openDetails(card.dataset.cardType,Number(card.dataset.id));return}
  var season=closest(e.target,'[data-season]');if(season&&state.current){state.selectedSeason=Number(season.dataset.season);renderSeriesArea(state.current,true);return}
  var play=closest(e.target,'[data-play-source]');if(play){startPlayback(play.dataset.playSource,play.dataset.playTitle);return}
  if(closest(e.target,'[data-action="details-back"]')){closeDetails();return}
  if(closest(e.target,'#heroPlay')){
    if(!state.heroItem)return;
    if(state.heroItem.source_url)startPlayback(state.heroItem.source_url,displayTitle(state.heroItem));
    else openDetails('show',state.heroItem.id);
    return;
  }
  if(closest(e.target,'#heroInfo')){
    if(state.heroItem)openDetails(state.heroItem.source_url?'movie':'show',state.heroItem.id);
  }
}
function registerKeys(){
  try{
    if(typeof tizen==='undefined'||!tizen.tvinputdevice)return;
    var manager=tizen.tvinputdevice;
    var wanted=['MediaPlayPause','MediaPlay','MediaPause','MediaFastForward','MediaRewind','MediaStop'];
    var supported=null;
    try{
      supported={};
      (manager.getSupportedKeys()||[]).forEach(function(k){if(k&&k.name)supported[k.name]=true});
    }catch(_){supported=null}
    var keys=supported?wanted.filter(function(k){return !!supported[k]}):wanted.slice();
    function registerIndividually(){keys.forEach(function(k){try{manager.registerKey(k)}catch(e){console.warn('Key registration failed',k,e)}})}
    if(!keys.length)return;
    if(manager.registerKeyBatch){
      try{manager.registerKeyBatch(keys,function(){},function(e){console.warn('Batch key registration failed',e);registerIndividually()})}
      catch(e){console.warn('Batch key registration exception',e);registerIndividually()}
    }else registerIndividually();
  }catch(e){console.warn(e)}
}
function key(e){
  var code=Number(e.keyCode||e.which||0);
  if(state.mode==='player'){
    if(!state.player){consume(e);return false}
    if(code===413){consume(e);stopPlayer(false);return false}
    if(code===10009||code===27){
      consume(e);
      if(state.playerPanel){closePlayerPanel();return false}
      if(state.playerMenuOpen){hidePlayerMenu();return false}
      stopPlayer(false);return false;
    }
    if(state.player.phase!=='playing'){consume(e);return false}
    if(code===10252){consume(e);playerToggle();return false}
    if(state.playerPanel){
      if(code===38){consume(e);playerMove('up');return false}
      if(code===40){consume(e);playerMove('down');return false}
      if(code===13){consume(e);activatePlayer();return false}
      if(code===37||code===39){consume(e);return false}
    }
    if(state.playerMenuOpen){
      if(code===37){consume(e);playerMove('left');return false}
      if(code===39){consume(e);playerMove('right');return false}
      if(code===13){consume(e);activatePlayer();return false}
      if(code===38||code===40){consume(e);return false}
    }
    if(code===13||code===38||code===40){consume(e);showPlayerMenu('#playerToggleButton');return false}
    if(code===37||code===412){consume(e);seek(-10000,function(){showPlayerMenu('[data-player-action=\"rewind\"]')});return false}
    if(code===39||code===417){consume(e);seek(10000,function(){showPlayerMenu('[data-player-action=\"forward\"]')});return false}
    return;
  }
  if([37,38,39,40,13].indexOf(code)>=0){
    consume(e);
    if(code===37)move('left');else if(code===38)move('up');else if(code===39)move('right');else if(code===40)move('down');else activate();
    return false;
  }
  if(code===10009||code===27){
    if(state.mode==='details'){consume(e);closeDetails();return false}
    if(state.mode==='search'){consume(e);closeSearch(true);state.focus=0;showShelf(firstVisibleShelf());rebuildFocus($('.nav-item.active'));return false}
  }
}

var scan=$('#scanButton');if(scan)scan.onclick=function(){api('/api/scan',{method:'POST'}).then(load).catch(function(){toast('Сканирование не удалось')})};
$('#searchInput').addEventListener('input',function(){clearTimeout(state.searchTimer);state.searchTimer=setTimeout(runSearch,250)});
window.addEventListener('keydown',key,true);
document.addEventListener('click',handleClick,false);
document.addEventListener('visibilitychange',handlePlayerVisibility);
registerKeys();
setInterval(function(){$('#clock').textContent=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})},1000);
load();
})();
