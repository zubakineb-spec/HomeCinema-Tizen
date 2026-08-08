(function(){
'use strict';

var state={
  catalog:{movies:[],shows:[]}, continueItems:[], focus:0, focusables:[], heroItem:null,
  mode:'home', view:'home', current:null, selectedSeason:null, player:null, saveTimer:null,
  searchTimer:null, tracksOpen:false
};
var $=function(s){return document.querySelector(s)};
var $$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
var API_BASE=(location.protocol==='http:'||location.protocol==='https:')?'':(window.HOME_CINEMA_API||'');

function api(path,opts){return fetch(API_BASE+path,opts).then(function(r){if(!r.ok){return r.text().then(function(t){throw new Error(t)})}return r.json()})}
function esc(v){return String(v||'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function visible(el){return !closest(el,'.hidden')}
function toast(msg){var e=$('#toast');e.textContent=msg;e.classList.remove('hidden');setTimeout(function(){e.classList.add('hidden')},2500)}
function fmtSeason(n){return 'Сезон '+Number(n||0)}
function pad2(v){v=String(v||0);return v.length<2?'0'+v:v}
function fmtEpisode(e){return 'S'+pad2(e.season)+'E'+pad2(e.episode)}

function card(item,type){
  var title=item.title||'Без названия';
  var img=item.poster_url||'';
  var meta=type==='show'?((item.season_count||0)+' сез. • '+(item.episode_count||0)+' сер.'):(item.year||'Фильм');
  return '<button class="card focusable" data-type="'+type+'" data-id="'+item.id+'">'+
    '<div class="poster" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'><span class="badge">'+(type==='show'?'СЕРИАЛ':'ФИЛЬМ')+'</span></div>'+
    '<div class="card-title">'+esc(title)+'</div><div class="card-meta">'+esc(meta)+'</div></button>';
}

function continueCard(item){
  var title=item.media_type==='episode'?(item.parent_title||item.title):(item.title||'Фильм');
  var subtitle=item.media_type==='episode'?(fmtEpisode(item)+' • '+(item.title||'Серия')):'Продолжить фильм';
  var img=item.image_url||item.backdrop_url||'';
  return '<button class="continue-card focusable" data-continue="1" data-source="'+esc(item.source_url)+'" data-title="'+esc(title+(item.media_type==='episode'?' — '+(item.title||'Серия'):''))+'">'+
    '<div class="continue-image" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'><div class="continue-shade"></div><div class="continue-copy">'+
    '<div class="continue-title">'+esc(title)+'</div><div class="continue-subtitle">'+esc(subtitle)+'</div><div class="continue-progress"><span style="width:'+Number(item.progress_percent||0)+'%"></span></div>'+
    '</div></div></button>';
}

function rebuildFocus(preferred){
  state.focusables=$$('.focusable').filter(visible);
  if(preferred){var i=state.focusables.indexOf(preferred);if(i>=0)state.focus=i}
  if(state.focus<0)state.focus=0;
  if(state.focus>=state.focusables.length)state.focus=Math.max(0,state.focusables.length-1);
  state.focusables.forEach(function(x){x.classList.remove('focused')});
  var el=state.focusables[state.focus];
  if(el){el.classList.add('focused');try{el.focus({preventScroll:true})}catch(_){try{el.focus()}catch(__){}}try{el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'})}catch(_){el.scrollIntoView(false)}}
}

function setHero(item){
  if(!item)return;
  state.heroItem=item;
  $('#heroTitle').textContent=item.title||'Домашний кинотеатр';
  $('#heroMeta').textContent=[item.year,item.rating?'★ '+Number(item.rating).toFixed(1):null,item.genres].filter(Boolean).join(' • ');
  $('#heroOverview').textContent=item.overview||'Описание будет добавлено после сопоставления с TMDb.';
  $('#hero').style.backgroundImage=item.backdrop_url?'url(\''+item.backdrop_url+'\')':'';
}

function setView(view){
  state.view=view;
  $$('.nav-item').forEach(function(x){x.classList.toggle('active',x.dataset.view===view)});
  if(view==='search'){openSearch();return}
  closeSearch(false);
  $('#movieSection').classList.toggle('hidden',view==='shows');
  $('#showSection').classList.toggle('hidden',view==='movies');
  $('#continueSection').classList.toggle('hidden',view!=='home'||!state.continueItems.length);
  state.mode='home';state.focus=0;rebuildFocus();
}

function wireCards(scope){
  (scope||document).querySelectorAll('.card').forEach(function(el){
    el.onclick=function(){openDetails(el.dataset.type,Number(el.dataset.id))};
    el.onfocus=function(){
      var type=el.dataset.type,id=Number(el.dataset.id);
      var arr=type==='movie'?state.catalog.movies:state.catalog.shows;
      var item=null;for(var i=0;i<arr.length;i++){if(Number(arr[i].id)===id){item=arr[i];break}}
      if(item&&state.mode==='home')setHero(item);
    };
  });
}

function loadContinue(){
  return api('/api/continue').then(function(x){
    state.continueItems=x.items||[];
    $('#continueRow').innerHTML=state.continueItems.map(continueCard).join('');
    $('#continueSection').classList.toggle('hidden',state.view!=='home'||!state.continueItems.length);
    $$('#continueRow [data-continue]').forEach(function(el){el.onclick=function(){play(el.dataset.source,el.dataset.title)}});
  }).catch(function(){state.continueItems=[];$('#continueSection').classList.add('hidden')});
}

function load(){
  return api('/api/catalog').then(function(catalog){
    state.catalog=catalog;
    $('#movieRow').innerHTML=state.catalog.movies.map(function(x){return card(x,'movie')}).join('');
    $('#showRow').innerHTML=state.catalog.shows.map(function(x){return card(x,'show')}).join('');
    var first=state.catalog.movies[0]||state.catalog.shows[0];
    setHero(first);
    $('#empty').classList.toggle('hidden',!!first);
    wireCards(document);
    return loadContinue();
  }).then(function(){rebuildFocus()}).catch(function(e){toast('Сервер каталога недоступен');console.error(e)});
}

function seasonTabs(item){
  return (item.seasons||[]).map(function(s){
    return '<button class="season-tab focusable '+(Number(s.number)===Number(state.selectedSeason)?'selected':'')+'" data-season="'+s.number+'">'+fmtSeason(s.number)+'</button>';
  }).join('');
}

function episodeRows(item){
  var season=null;var allSeasons=item.seasons||[];for(var i=0;i<allSeasons.length;i++){if(Number(allSeasons[i].number)===Number(state.selectedSeason)){season=allSeasons[i];break}}
  if(!season)return '<div class="episode-meta">Серии не найдены.</div>';
  return season.episodes.map(function(e){
    var still=e.still_url||item.backdrop_url||'';
    return '<button class="episode focusable" data-source="'+esc(e.source_url)+'" data-title="'+esc(item.title+' — '+(e.title||('Серия '+e.episode)))+'">'+
      '<div class="episode-still" '+(still?'style="background-image:url(\''+esc(still)+'\')"':'')+'></div><div><div class="episode-title">'+fmtEpisode(e)+' — '+esc(e.title||('Серия '+e.episode))+'</div>'+
      '<div class="episode-meta">'+[e.runtime?e.runtime+' мин':null,e.air_date].filter(Boolean).join(' • ')+'</div><div class="episode-overview">'+esc(e.overview||'')+'</div></div></button>';
  }).join('');
}

function renderShowPane(item){
  var pane=$('#seriesPane');
  if(!pane)return;
  pane.innerHTML='<div class="season-tabs">'+seasonTabs(item)+'</div><div class="episode-list">'+episodeRows(item)+'</div>';
  pane.querySelectorAll('[data-season]').forEach(function(el){el.onclick=function(){var seasonNo=Number(el.dataset.season);state.selectedSeason=seasonNo;renderShowPane(item);var next=pane.querySelector('[data-season="'+seasonNo+'"]');rebuildFocus(next)}});
  pane.querySelectorAll('[data-source]').forEach(function(el){el.onclick=function(){play(el.dataset.source,el.dataset.title)}});
  rebuildFocus();
}

function openDetails(type,id){
  return api(type==='movie'?'/api/movies/'+id:'/api/shows/'+id).then(function(item){
    state.mode='details';state.current=item;
    if(type==='show')state.selectedSeason=item.seasons&&item.seasons.length?item.seasons[0].number:null;
    var bg=item.backdrop_url?'<div class="details-bg" style="background-image:url(\''+esc(item.backdrop_url)+'\')"></div>':'';
    var playButton=type==='movie'?'<button class="focusable primary" data-source="'+esc(item.source_url)+'" data-title="'+esc(item.title)+'">▶ Смотреть</button>':'';
    var series=type==='show'?'<div id="seriesPane" class="series-pane"></div>':'';
    $('#details').innerHTML=bg+'<div class="details-shade"></div><div class="details-content"><div class="eyebrow">'+(type==='show'?'СЕРИАЛ':'ФИЛЬМ')+'</div><h1>'+esc(item.title)+'</h1><div class="hero-meta">'+[item.year,item.rating?'★ '+Number(item.rating).toFixed(1):null,item.genres].filter(Boolean).join(' • ')+'</div><p>'+esc(item.overview||'Описание будет добавлено после сопоставления с TMDb.')+'</p><div class="details-buttons">'+playButton+'<button class="focusable" data-back="1">Назад</button></div></div>'+series;
    $('#details').classList.remove('hidden');
    $('#details').querySelectorAll('[data-source]').forEach(function(x){x.onclick=function(){play(x.dataset.source,x.dataset.title)}});
    $('#details').querySelector('[data-back]').onclick=closeDetails;
    if(type==='show')renderShowPane(item);
    state.focus=0;rebuildFocus();
  });
}

function closeDetails(){
  $('#details').classList.add('hidden');state.mode='home';state.current=null;state.focus=0;rebuildFocus();
}

function openSearch(){
  state.mode='search';$('#searchOverlay').classList.remove('hidden');$('#movieSection').classList.add('hidden');$('#showSection').classList.add('hidden');$('#continueSection').classList.add('hidden');
  var input=$('#searchInput');state.focus=0;rebuildFocus(input);setTimeout(function(){input.focus()},50);
}

function closeSearch(resetView){
  $('#searchOverlay').classList.add('hidden');
  if(resetView!==false&&state.view==='search'){state.view='home';$$('.nav-item').forEach(function(x){x.classList.toggle('active',x.dataset.view==='home')});$('#movieSection').classList.remove('hidden');$('#showSection').classList.remove('hidden');$('#continueSection').classList.toggle('hidden',!state.continueItems.length)}
}

function runSearch(){
  var q=$('#searchInput').value.trim();
  if(!q){$('#searchResults').innerHTML='';rebuildFocus($('#searchInput'));return}
  api('/api/search?q='+encodeURIComponent(q)).then(function(result){
    var html=result.movies.map(function(x){return card(x,'movie')}).join('')+result.shows.map(function(x){return card(x,'show')}).join('');
    $('#searchResults').innerHTML=html||'<div class="episode-meta">Ничего не найдено</div>';
    wireCards($('#searchResults'));rebuildFocus($('#searchInput'));
  }).catch(function(){toast('Ошибка поиска')});
}

function avAvailable(){return typeof webapis!=='undefined'&&webapis.avplay}
function parseExtra(value){try{return JSON.parse(value||'{}')}catch(_){return {}}}
function trackLabel(info){
  var x=parseExtra(info.extra_info);
  var lang=x.language||x.track_lang||'Неизвестно';
  var codec=x.fourCC||'';var channels=x.channels?x.channels+' ch':'';
  return [String(lang).toUpperCase(),channels,codec].filter(Boolean).join(' • ');
}

function populateTracks(){
  if(!avAvailable()||!state.player||state.player.html)return;
  var p=webapis.avplay,total=[],current=[];
  try{total=p.getTotalTrackInfo()||[];current=p.getCurrentStreamInfo()||[]}catch(e){console.warn('Track info unavailable',e);return}
  var selected={};current.forEach(function(x){selected[x.type]=Number(x.index)});
  var audio=total.filter(function(x){return x.type==='AUDIO'});
  var text=total.filter(function(x){return x.type==='TEXT'});
  $('#audioTracks').innerHTML=audio.length?audio.map(function(x){return '<button class="track-option focusable '+(selected.AUDIO===Number(x.index)?'selected':'')+'" data-track="AUDIO" data-index="'+x.index+'">'+esc(trackLabel(x))+'</button>'}).join(''):'<div class="episode-meta">Одна дорожка</div>';
  $('#subtitleTracks').innerHTML='<button class="track-option focusable" data-suboff="1">Выкл.</button>'+text.map(function(x){return '<button class="track-option focusable '+(selected.TEXT===Number(x.index)?'selected':'')+'" data-track="TEXT" data-index="'+x.index+'">'+esc(trackLabel(x))+'</button>'}).join('');
  $$('#trackPanel [data-track]').forEach(function(el){el.onclick=function(){
    try{p.setSilentSubtitle(false);p.setSelectTrack(el.dataset.track,Number(el.dataset.index));populateTracks();toast((el.dataset.track==='AUDIO'?'Аудио: ':'Субтитры: ')+el.textContent)}catch(e){toast('Дорожку переключить не удалось')}
  }});
  var off=$('#trackPanel [data-suboff]');if(off)off.onclick=function(){try{p.setSilentSubtitle(true);$('#subtitleText').textContent='';toast('Субтитры выключены')}catch(e){toast('Не удалось выключить субтитры')}};
}

function toggleTracks(force){
  if(!state.player||state.player.html){toast('Выбор дорожек доступен через Samsung AVPlay');return}
  state.tracksOpen=typeof force==='boolean'?force:!state.tracksOpen;
  $('#trackPanel').classList.toggle('hidden',!state.tracksOpen);
  if(state.tracksOpen){populateTracks();state.focus=0;rebuildFocus()}else{rebuildFocus()}
}

function play(url,title){
  state.mode='player';state.player={url:url,title:title,html:false};state.tracksOpen=false;
  $('#playerTitle').textContent=title||'Воспроизведение';$('#player').classList.remove('hidden');$('#trackPanel').classList.add('hidden');$('#subtitleText').textContent='';
  try{
    if(avAvailable()){
      var p=webapis.avplay;try{p.close()}catch(_){}
      p.open(url);p.setDisplayRect(0,0,1920,1080);p.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      p.setListener({
        onbufferingstart:function(){toast('Буферизация…')},onbufferingcomplete:function(){},
        oncurrentplaytime:function(t){updateProgress(t,p.getDuration())},onstreamcompleted:function(){stopPlayer(true)},
        onsubtitlechange:function(duration,text){$('#subtitleText').textContent=text||'';if(text)setTimeout(function(){if($('#subtitleText').textContent===text)$('#subtitleText').textContent=''},Number(duration)||2500)},
        onerror:function(e){fallbackVideo(url,e)}
      });
      p.prepareAsync(function(){p.play();restoreProgress(url,p);setTimeout(populateTracks,250)},function(e){fallbackVideo(url,e)});
    }else fallbackVideo(url);
  }catch(e){fallbackVideo(url,e)}
}

function restoreProgress(url,p){api('/api/progress?source_url='+encodeURIComponent(url)).then(function(x){if(x.position_ms>15000&&x.completed!==1)p.seekTo(x.position_ms)}).catch(function(){})}
function fallbackVideo(url,why){console.warn('AVPlay fallback',why);state.player.html=true;var v=$('#htmlVideo');v.src=url;v.classList.remove('hidden');v.play().catch(function(){toast('Формат не поддерживается телевизором')});v.ontimeupdate=function(){updateProgress(v.currentTime*1000,v.duration*1000)};v.onended=function(){stopPlayer(true)}}
function updateProgress(pos,dur){var pct=dur?Math.max(0,Math.min(100,pos/dur*100)):0;$('#playerProgress').style.width=pct+'%';if(!state.saveTimer){state.saveTimer=setTimeout(function(){state.saveTimer=null;saveProgress(pos,dur,pct>95)},5000)}}
function saveProgress(pos,dur,completed){if(!state.player)return;fetch(API_BASE+'/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_url:state.player.url,position_ms:Math.round(pos||0),duration_ms:Math.round(dur||0),completed:!!completed})}).catch(function(){})}
function playerToggle(){if(!state.player)return;if(state.player.html){var v=$('#htmlVideo');v.paused?v.play():v.pause();return}try{var p=webapis.avplay;p.getState()==='PLAYING'?p.pause():p.play()}catch(_){}}
function seek(delta){if(!state.player)return;if(state.player.html){var v=$('#htmlVideo');v.currentTime=Math.max(0,v.currentTime+delta/1000);return}try{var p=webapis.avplay;delta>0?p.jumpForward(delta):p.jumpBackward(Math.abs(delta))}catch(_){}}
function stopPlayer(completed){
  if(!state.player)return;var pos=0,dur=0;
  try{if(state.player.html){var v=$('#htmlVideo');pos=v.currentTime*1000;dur=v.duration*1000;v.pause();v.removeAttribute('src');v.load();v.classList.add('hidden')}else{var p=webapis.avplay;pos=p.getCurrentTime();dur=p.getDuration();p.stop();p.close()}}catch(_){}
  saveProgress(pos,dur,completed);$('#player').classList.add('hidden');$('#trackPanel').classList.add('hidden');$('#subtitleText').textContent='';state.player=null;state.tracksOpen=false;state.mode=state.current?'details':'home';loadContinue().then(function(){rebuildFocus()});
}

function move(dir){
  if(!state.focusables.length)return;var cur=state.focusables[state.focus];var r=cur.getBoundingClientRect();var best=state.focus,bestScore=Infinity;
  state.focusables.forEach(function(el,i){if(i===state.focus)return;var x=el.getBoundingClientRect();var dx=(x.left+x.right-r.left-r.right)/2,dy=(x.top+x.bottom-r.top-r.bottom)/2;
    if((dir==='left'&&dx>=0)||(dir==='right'&&dx<=0)||(dir==='up'&&dy>=0)||(dir==='down'&&dy<=0))return;
    var primary=(dir==='left'||dir==='right')?Math.abs(dx):Math.abs(dy);var cross=(dir==='left'||dir==='right')?Math.abs(dy):Math.abs(dx);var score=primary+cross*2.4;if(score<bestScore){bestScore=score;best=i}
  });state.focus=best;rebuildFocus();
}
function activate(){var el=state.focusables[state.focus];if(el){if(el.tagName==='INPUT'){el.focus()}else el.click()}}
function registerKeys(){try{if(typeof tizen!=='undefined'&&tizen.tvinputdevice)tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause','MediaPlay','MediaPause','MediaFastForward','MediaRewind'])}catch(e){console.warn(e)}}

function key(e){
  if(state.mode==='player'){
    if(state.tracksOpen){
      if(e.keyCode===37)move('left');else if(e.keyCode===38)move('up');else if(e.keyCode===39)move('right');else if(e.keyCode===40)move('down');else if(e.keyCode===13)activate();else if([10009,27].indexOf(e.keyCode)>=0||e.keyCode===40)toggleTracks(false);return;
    }
    if([13,10252].indexOf(e.keyCode)>=0){playerToggle();return}
    if(e.keyCode===37||e.keyCode===412){seek(-10000);return}
    if(e.keyCode===39||e.keyCode===417){seek(10000);return}
    if(e.keyCode===38){toggleTracks(true);return}
    if([10009,27].indexOf(e.keyCode)>=0){stopPlayer(false);return}
  }
  if(e.keyCode===37)move('left');else if(e.keyCode===38)move('up');else if(e.keyCode===39)move('right');else if(e.keyCode===40)move('down');else if(e.keyCode===13)activate();else if([10009,27].indexOf(e.keyCode)>=0){if(state.mode==='details')closeDetails();else if(state.mode==='search'){closeSearch(true);state.mode='home';state.focus=0;rebuildFocus()}}
}

function bindStatic(){
  $$('.nav-item').forEach(function(el){el.onclick=function(){setView(el.dataset.view)}});
  $('#heroPlay').onclick=function(){if(state.heroItem){if(state.heroItem.source_url)play(state.heroItem.source_url,state.heroItem.title);else openDetails('show',state.heroItem.id)}};
  var scan=$('#scanButton');if(scan)scan.onclick=function(){toast('Сканирование запущено…');api('/api/scan',{method:'POST'}).then(function(r){toast('Найдено: '+r.movies+' фильмов, '+r.shows+' сериалов, '+r.episodes+' серий');return load()}).catch(function(){toast('Не удалось просканировать медиатеку')})};
  $('#searchInput').addEventListener('input',function(){clearTimeout(state.searchTimer);state.searchTimer=setTimeout(runSearch,250)});
}

document.addEventListener('keydown',key);
document.addEventListener('click',function(e){var f=closest(e.target,'.focusable');if(f){var i=state.focusables.indexOf(f);if(i>=0){state.focus=i;rebuildFocus(f)}}});
document.addEventListener('visibilitychange',function(){if(!state.player||state.player.html||!avAvailable())return;try{document.hidden?webapis.avplay.suspend():webapis.avplay.restore()}catch(e){console.warn(e)}});
registerKeys();bindStatic();setInterval(function(){$('#clock').textContent=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})},1000);load();
})();
