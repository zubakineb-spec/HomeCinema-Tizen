(function(){
'use strict';

window.HOME_CINEMA_RC='rc3.10-series-page';

var page=null;
var current=null;
var selectedSeason=null;
var focusables=[];
var focusIndex=0;
var openedFromSearch=false;
var requestToken=0;

function $(selector,root){return (root||document).querySelector(selector)}
function $$(selector,root){return Array.prototype.slice.call((root||document).querySelectorAll(selector))}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]})}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function apiBase(){return (location.protocol==='http:'||location.protocol==='https:')?'':(window.HOME_CINEMA_API||'')}
function mappedImage(value){var v=String(value||''),map=window.HOME_CINEMA_IMAGE_MAP||{};return map[v]||v}
function titleOf(item){return String((item&&(item.recognized_title||item.original_title||item.title))||'Сериал')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}try{e.stopPropagation()}catch(_){}return false}
function playerVisible(){var p=$('#player');return !!(p&&!p.classList.contains('hidden'))}
function pageOpen(){return !!(page&&!page.classList.contains('hidden'))}
function seasonData(number){
  var list=(current&&current.seasons)||[];
  for(var i=0;i<list.length;i++)if(Number(list[i].number)===Number(number))return list[i];
  return null;
}
function episodeCode(e){
  var s=String(e&&e.season||selectedSeason||0),n=String(e&&e.episode||0);
  if(s.length<2)s='0'+s;if(n.length<2)n='0'+n;
  return 'S'+s+'E'+n;
}
function episodeTitle(e){return titleOf(current)+' — '+String((e&&e.title)||('Серия '+(e&&e.episode||'')))}
function restoreSearchSurface(){
  if(!openedFromSearch)return;
  var overlay=$('#searchOverlay'),input=$('#searchInput');
  if(overlay)overlay.classList.remove('hidden');
  if(input){input.style.visibility='';try{input.focus()}catch(_){} }
}
function hideSearchSurface(){
  var overlay=$('#searchOverlay'),input=$('#searchInput');
  openedFromSearch=!!(overlay&&!overlay.classList.contains('hidden'));
  if(input){input.classList.remove('focused');try{input.blur()}catch(_){}input.style.visibility='hidden'}
  if(overlay)overlay.classList.add('hidden');
}
function closeSeriesPage(){
  if(!pageOpen())return;
  page.classList.add('hidden');
  page.innerHTML='';
  current=null;selectedSeason=null;focusables=[];focusIndex=0;
  restoreSearchSurface();
  openedFromSearch=false;
}
function ensurePage(){
  if(page)return page;
  page=document.createElement('div');
  page.id='series310Page';
  page.className='series310-page hidden';
  document.getElementById('app').appendChild(page);
  return page;
}
function fetchShow(id){
  return fetch(apiBase()+'/api/shows/'+encodeURIComponent(id)).then(function(r){
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.json();
  });
}
function renderShell(item){
  var img=mappedImage(item.backdrop_url||item.poster_url||'');
  var meta=[];
  if(Number(item.rating||0)>0)meta.push('<span class="series310-rating">'+Number(item.rating).toFixed(1)+'</span>');
  if(item.year)meta.push('<span class="series310-meta-item">'+esc(item.year)+'</span>');
  if(item.genres)meta.push('<span class="series310-meta-item">'+esc(item.genres)+'</span>');
  if(Number(item.season_count||0)>0)meta.push('<span class="series310-meta-item">'+Number(item.season_count)+' сез.</span>');
  page.innerHTML='<div class="series310-bg" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'></div>'+
    '<div class="series310-shade"></div>'+
    '<div class="series310-header"><button class="series310-back series310-focusable" data-series310-back="1">←</button><div class="series310-header-label">СЕРИАЛ</div></div>'+
    '<div class="series310-copy"><div class="series310-kicker">ВЫБОР СЕЗОНА И СЕРИИ</div><h1 class="series310-title">'+esc(titleOf(item))+'</h1>'+
    '<div class="series310-meta">'+meta.join('')+'</div><div class="series310-overview">'+esc(item.overview||'Описание отсутствует')+'</div></div>'+
    '<div class="series310-browser"><h2>Сезоны</h2><div id="series310SeasonRail" class="series310-season-rail"></div>'+
    '<h2 class="series310-episodes-title">Серии</h2><div id="series310EpisodeRail" class="series310-episode-rail"></div></div>';
  page.classList.remove('hidden');
  renderSeasons();
  renderEpisodes();
}
function renderSeasons(){
  var rail=$('#series310SeasonRail',page);if(!rail)return;
  var seasons=(current&&current.seasons)||[];
  rail.innerHTML=seasons.map(function(s){
    var selected=Number(s.number)===Number(selectedSeason);
    return '<button class="series310-season series310-focusable '+(selected?'selected':'')+'" data-series310-season="'+Number(s.number)+'">Сезон '+Number(s.number)+'</button>';
  }).join('');
}
function renderEpisodes(){
  var rail=$('#series310EpisodeRail',page);if(!rail)return;
  var season=seasonData(selectedSeason),episodes=(season&&season.episodes)||[];
  if(!episodes.length){rail.innerHTML='<div class="series310-empty">В этом сезоне серии не найдены</div>';rebuildFocus();return}
  rail.innerHTML=episodes.map(function(e){
    var img=mappedImage(e.still_url||current.backdrop_url||current.poster_url||'');
    var progress=Math.max(0,Math.min(100,Number(e.progress_percent||0)));
    var meta=[e.runtime?Number(e.runtime)+' мин':'',e.air_date||''].filter(Boolean).join(' · ');
    return '<button class="series310-episode series310-focusable" data-play-source="'+esc(e.source_url||'')+'" data-play-title="'+esc(episodeTitle(e))+'">'+
      '<div class="series310-episode-thumb" '+(img?'style="background-image:url(\''+esc(img)+'\')"':'')+'>'+
      (progress>0?'<div class="series310-episode-progress"><span style="width:'+progress+'%"></span></div>':'')+'</div>'+
      '<div class="series310-episode-title">'+episodeCode(e)+' · '+esc(e.title||('Серия '+e.episode))+'</div>'+
      '<div class="series310-episode-meta">'+esc(meta)+'</div></button>';
  }).join('');
  rebuildFocus($('.series310-episode',page)||$('.series310-season.selected',page));
}
function rowOf(el){
  if(!el)return '';
  if(el.classList.contains('series310-back'))return 'back';
  if(el.classList.contains('series310-season'))return 'seasons';
  if(el.classList.contains('series310-episode'))return 'episodes';
  return '';
}
function rebuildFocus(preferred){
  focusables=$$('.series310-focusable',page).filter(function(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0});
  if(preferred){var p=focusables.indexOf(preferred);if(p>=0)focusIndex=p}
  if(focusIndex<0)focusIndex=0;if(focusIndex>=focusables.length)focusIndex=Math.max(0,focusables.length-1);
  focusables.forEach(function(el){el.classList.remove('series310-focused')});
  var target=focusables[focusIndex];
  if(target){target.classList.add('series310-focused');try{target.focus()}catch(_){}ensureVisible(target)}
}
function focusElement(el){if(!el)return;rebuildFocus(el)}
function ensureVisible(el){
  var rail=closest(el,'.series310-season-rail')||closest(el,'.series310-episode-rail');if(!rail)return;
  var rr=rail.getBoundingClientRect(),er=el.getBoundingClientRect();
  if(er.left<rr.left+6)rail.scrollLeft-=Math.max(0,(rr.left+6-er.left));
  else if(er.right>rr.right-46)rail.scrollLeft+=Math.max(0,(er.right-(rr.right-46)));
}
function elementsInRow(row){return focusables.filter(function(el){return rowOf(el)===row})}
function move(dir){
  if(!focusables.length)rebuildFocus();
  var cur=focusables[focusIndex];if(!cur)return;
  var row=rowOf(cur),rows=['back','seasons','episodes'],rowItems=elementsInRow(row),pos=rowItems.indexOf(cur),target=null;
  if(dir==='left'&&pos>0)target=rowItems[pos-1];
  else if(dir==='right'&&pos>=0&&pos<rowItems.length-1)target=rowItems[pos+1];
  else if(dir==='up'||dir==='down'){
    var ri=rows.indexOf(row)+(dir==='down'?1:-1);
    while(ri>=0&&ri<rows.length&&!elementsInRow(rows[ri]).length)ri+=(dir==='down'?1:-1);
    if(ri>=0&&ri<rows.length){
      var candidates=elementsInRow(rows[ri]);
      if(candidates.length){
        var cr=cur.getBoundingClientRect(),cx=(cr.left+cr.right)/2,best=999999;
        candidates.forEach(function(x){var r=x.getBoundingClientRect(),d=Math.abs(((r.left+r.right)/2)-cx);if(d<best){best=d;target=x}});
      }
    }
  }
  if(target)focusElement(target);
}
function activate(){
  var el=focusables[focusIndex];if(!el)return;
  if(el.hasAttribute('data-series310-back')){closeSeriesPage();return}
  if(el.hasAttribute('data-series310-season')){selectSeason(Number(el.getAttribute('data-series310-season')));return}
  try{el.click()}catch(_){}
}
function selectSeason(number){
  selectedSeason=number;
  renderSeasons();
  renderEpisodes();
  focusElement($('.series310-episode',page)||$('.series310-season.selected',page));
}
function openSeriesPage(id){
  var token=++requestToken;
  ensurePage();hideSearchSurface();
  page.innerHTML='<div class="series310-shade"></div><div class="series310-copy"><div class="series310-kicker">СЕРИАЛ</div><h1 class="series310-title">Загрузка…</h1></div>';
  page.classList.remove('hidden');
  fetchShow(id).then(function(item){
    if(token!==requestToken)return;
    current=item||{};
    var seasons=current.seasons||[];
    selectedSeason=seasons.length?Number(seasons[0].number):null;
    renderShell(current);
    focusIndex=0;
    rebuildFocus($('.series310-season.selected',page)||$('.series310-back',page));
  }).catch(function(e){
    if(token!==requestToken)return;
    console.error('RC3.10 series page failed',e);
    page.innerHTML='<div class="series310-shade"></div><div class="series310-copy"><div class="series310-kicker">СЕРИАЛ</div><h1 class="series310-title">Не удалось открыть сериал</h1><div class="series310-overview">Проверьте соединение с домашним сервером.</div></div><div class="series310-header"><button class="series310-back series310-focusable" data-series310-back="1">←</button></div>';
    rebuildFocus($('.series310-back',page));
  });
}
function clickCapture(e){
  var card=closest(e.target,'[data-card-type="show"]');
  if(card&&!pageOpen()){
    consume(e);
    openSeriesPage(Number(card.getAttribute('data-id')||0));
    return false;
  }
  if(!pageOpen())return;
  var back=closest(e.target,'[data-series310-back]');
  if(back){consume(e);closeSeriesPage();return false}
  var season=closest(e.target,'[data-series310-season]');
  if(season){consume(e);selectSeason(Number(season.getAttribute('data-series310-season')));return false}
  var episode=closest(e.target,'.series310-episode');
  if(episode){focusElement(episode);return}
}
function keyCapture(e){
  if(!pageOpen()||playerVisible())return;
  var code=Number(e.keyCode||e.which||0);
  if(code===10009||code===27){consume(e);closeSeriesPage();return false}
  if(code===37){consume(e);move('left');return false}
  if(code===38){consume(e);move('up');return false}
  if(code===39){consume(e);move('right');return false}
  if(code===40){consume(e);move('down');return false}
  if(code===13){consume(e);activate();return false}
}

document.addEventListener('click',clickCapture,true);
window.addEventListener('keydown',keyCapture,true);
})();
