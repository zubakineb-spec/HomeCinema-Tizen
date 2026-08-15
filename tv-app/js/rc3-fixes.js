(function(){
'use strict';

var API=window.HOME_CINEMA_API||'http://192.168.0.101:8096';
var PREF_KEY='homecinema.playerPrefs.v1';
var prefs=loadPrefs();
var catalog=null;
var featured=null;
var featuredActive=false;
var activeShow=null;
var showCache={};
var patchTimer=null;

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function api(path){return fetch(API.replace(/\/$/,'')+path).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})}
function cleanFallbackTitle(value){
  var v=String(value||'').replace(/\.[A-Za-z0-9]{2,5}$/,'');
  v=v.replace(/[._]+/g,' ').replace(/\b(2160p|1080p|720p|WEB[- .]?DL|WEBRip|BluRay|BDRip|HDRip|DVDRip|x264|x265|HEVC|AVC|AAC|DTS|AC3|EAC3|DDP|REMUX)\b/ig,' ');
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
function itemScore(item){
  var rating=Number(item&&item.rating||0),year=Number(item&&item.year||0),score=rating*100;
  if(item&&(item.backdrop_url||item.poster_url))score+=30;
  if(item&&String(item.overview||'').trim())score+=20;
  if(year>0)score+=Math.min(20,Math.max(0,(year-2000)/2));
  return score;
}
function pickFeatured(c){
  var all=[];
  (c.movies||[]).forEach(function(x){all.push(x)});
  (c.shows||[]).forEach(function(x){all.push(x)});
  if(!all.length)return null;
  all.sort(function(a,b){return itemScore(b)-itemScore(a)});
  return all[0];
}
function renderFeatured(item){
  if(!item)return;
  featured=item;featuredActive=true;
  var title=$('#heroTitle'),meta=$('#heroMeta'),overview=$('#heroOverview'),hero=$('#hero'),eyebrow=$('#hero .eyebrow');
  if(title)title.textContent=displayTitle(item)||'Домашний кинотеатр';
  if(meta)meta.textContent=[item.year,item.rating?'★ '+Number(item.rating).toFixed(1):null,item.genres].filter(Boolean).join(' · ');
  if(overview)overview.textContent=item.overview||'Фильмы и сериалы из вашей медиатеки.';
  if(hero){var img=item.backdrop_url||item.poster_url||'';hero.style.backgroundImage=img?'url("'+img.replace(/"/g,'')+'")':''}
  if(eyebrow)eyebrow.textContent='РЕКОМЕНДУЕМ ИЗ МЕДИАТЕКИ';
}
function waitForCatalogRender(tries){
  if(!featured)return;
  var ready=($('#movieRow')&&$('#movieRow').children.length)||($('#showRow')&&$('#showRow').children.length);
  if(ready){renderFeatured(featured);return}
  if(tries>0)setTimeout(function(){waitForCatalogRender(tries-1)},120);
}
function featureCard(){
  if(!featured)return null;
  var type=featured.source_url?'movie':'show';
  return $('[data-card-type="'+type+'"][data-id="'+featured.id+'"]');
}
function clickDetailPlay(tries){
  var b=$('#detailPlay');
  if(b){b.click();return}
  if(tries>0)setTimeout(function(){clickDetailPlay(tries-1)},100);
}

function loadPrefs(){
  var d={subtitleOff:true,audio:null,subtitle:null};
  try{
    var raw=window.localStorage&&window.localStorage.getItem(PREF_KEY);
    if(!raw)return d;
    var x=JSON.parse(raw)||{};
    if(x.subtitleOff===false)d.subtitleOff=false;
    if(x.audio)d.audio=x.audio;
    if(x.subtitle)d.subtitle=x.subtitle;
  }catch(_){}
  return d;
}
function savePrefs(){try{if(window.localStorage)window.localStorage.setItem(PREF_KEY,JSON.stringify(prefs))}catch(_){}}
function parseExtra(v){if(v&&typeof v==='object')return v;try{return JSON.parse(v||'{}')}catch(_){return {}}}
function rawTrackData(track){
  var x=parseExtra(track&&track.extra_info),lang=x.language||x.track_lang||x.lang||'';
  return {index:Number(track&&track.index),lang:String(lang||'').toLowerCase(),fourCC:String(x.fourCC||'').toUpperCase()};
}
function isDts(track){var d=rawTrackData(track);return d.fourCC.indexOf('DTS')>=0||d.fourCC.indexOf('DCA')>=0}
function totalTracks(av){try{return av.getTotalTrackInfo()||[]}catch(_){return []}}
function rememberTrack(av,type,index){
  var total=totalTracks(av),track=null,i;
  for(i=0;i<total.length;i++)if(total[i].type===type&&Number(total[i].index)===Number(index)){track=total[i];break}
  if(!track)return;
  if(type==='AUDIO')prefs.audio=rawTrackData(track);
  if(type==='TEXT'){prefs.subtitle=rawTrackData(track);prefs.subtitleOff=false}
  savePrefs();
}
function findPreferred(total,type,pref){
  if(!pref)return null;
  var list=total.filter(function(x){return x.type===type}),i,d;
  for(i=0;i<list.length;i++){
    d=rawTrackData(list[i]);
    if(pref.lang&&d.lang===pref.lang&&(!pref.fourCC||d.fourCC===pref.fourCC))return list[i];
  }
  for(i=0;i<list.length;i++)if(Number(list[i].index)===Number(pref.index))return list[i];
  return null;
}
function applyPrefs(av,origSilent,origSelect){
  try{
    var total=totalTracks(av),audio=findPreferred(total,'AUDIO',prefs.audio),text=findPreferred(total,'TEXT',prefs.subtitle);
    if(audio&&!isDts(audio))origSelect.call(av,'AUDIO',Number(audio.index));
    if(prefs.subtitleOff!==false){origSilent.call(av,true)}
    else{
      origSilent.call(av,false);
      if(text)origSelect.call(av,'TEXT',Number(text.index));
    }
  }catch(e){try{console.warn('RC3 preference restore failed',e)}catch(_){}}
}
function patchAvplay(){
  if(typeof webapis==='undefined'||!webapis.avplay)return;
  var av=webapis.avplay;
  if(av.__homeCinemaRc3Prefs)return;
  var origOpen=av.open,origPlay=av.play,origSilent=av.setSilentSubtitle,origSelect=av.setSelectTrack;
  if(typeof origOpen!=='function'||typeof origPlay!=='function'||typeof origSilent!=='function'||typeof origSelect!=='function')return;
  var restorePending=false;
  av.open=function(url){restorePending=true;return origOpen.call(av,url)};
  av.play=function(){
    var r=origPlay.call(av);
    if(restorePending){restorePending=false;setTimeout(function(){applyPrefs(av,origSilent,origSelect)},180)}
    return r;
  };
  av.setSilentSubtitle=function(silent){
    var r=origSilent.call(av,silent);prefs.subtitleOff=!!silent;savePrefs();return r;
  };
  av.setSelectTrack=function(type,index){
    var r=origSelect.call(av,type,Number(index));rememberTrack(av,type,Number(index));return r;
  };
  av.__homeCinemaRc3Prefs=true;
}

function scheduleEpisodePatch(){clearTimeout(patchTimer);patchTimer=setTimeout(patchEpisodeDescriptions,70)}
function findShowByDetailsTitle(title){
  if(!catalog)return null;
  var shows=catalog.shows||[],i;
  for(i=0;i<shows.length;i++)if(displayTitle(shows[i])===title)return shows[i];
  return null;
}
function loadShow(id){
  id=Number(id||0);if(!id)return Promise.resolve(null);
  if(showCache[id])return Promise.resolve(showCache[id]);
  return api('/api/shows/'+id).then(function(x){showCache[id]=x;return x});
}
function ensureActiveShow(){
  var details=$('#details');if(!details||details.classList.contains('hidden')||!$('#seriesArea',details))return Promise.resolve(null);
  var titleEl=$('.details-title',details),title=titleEl?titleEl.textContent:'';
  if(activeShow&&displayTitle(activeShow)===title)return Promise.resolve(activeShow);
  var cat=findShowByDetailsTitle(title);
  if(!cat)return Promise.resolve(null);
  return loadShow(cat.id).then(function(x){activeShow=x;return x});
}
function patchEpisodeDescriptions(){
  ensureActiveShow().then(function(show){
    if(!show)return;
    var selected=$('.season-tab.selected',$('#seriesArea')),seasonNumber=selected?Number(selected.getAttribute('data-season')):null;
    var seasons=show.seasons||[],season=null,i;
    for(i=0;i<seasons.length;i++)if(Number(seasons[i].number)===seasonNumber){season=seasons[i];break}
    if(!season)return;
    var cards=$$('#seriesArea [data-nav-row="episodes"] .episode-card'),episodes=season.episodes||[];
    for(i=0;i<cards.length&&i<episodes.length;i++){
      var old=$('.episode-overview',cards[i]);if(old)old.parentNode.removeChild(old);
      var d=document.createElement('div');d.className='episode-overview';
      d.textContent=String(episodes[i].overview||'Описание серии отсутствует');
      cards[i].appendChild(d);
    }
  }).catch(function(){})
}

function timelineFocused(){
  var t=$('#playerTimelineButton');return !!t&&(document.activeElement===t||t.classList.contains('focused'));
}
function timelineSeek(delta){
  if(typeof webapis==='undefined'||!webapis.avplay)return;
  var av=webapis.avplay;
  try{
    var state=av.getState();if(state!=='PLAYING'&&state!=='PAUSED')return;
    var done=function(){var t=$('#playerTimelineButton');if(t){t.classList.add('focused');try{t.focus()}catch(_){}}};
    if(delta>0)av.jumpForward(delta,done,function(){done()});else av.jumpBackward(Math.abs(delta),done,function(){done()});
    var text=$('#playerStateText');if(text){text.textContent=(delta>0?'+':'−')+Math.abs(delta/1000)+' сек';setTimeout(function(){if(text)text.textContent='Воспроизведение'},900)}
  }catch(e){try{console.warn('RC3 timeline seek failed',e)}catch(_){}}
}

api('/api/catalog').then(function(c){catalog=c||{movies:[],shows:[]};featured=pickFeatured(catalog);waitForCatalogRender(30)}).catch(function(){});
patchAvplay();

document.addEventListener('focusin',function(e){if(closest(e.target,'[data-card-type]'))featuredActive=false},true);
document.addEventListener('click',function(e){
  var heroButton=closest(e.target,'#heroPlay')||closest(e.target,'#heroInfo');
  if(heroButton&&featuredActive&&featured){
    try{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()}catch(_){}
    var card=featureCard();if(!card)return;
    featuredActive=false;card.click();
    if(heroButton.id==='heroPlay')clickDetailPlay(20);
    return false;
  }
  var showCard=closest(e.target,'[data-card-type="show"]');
  if(showCard){
    loadShow(showCard.getAttribute('data-id')).then(function(x){activeShow=x;scheduleEpisodePatch()}).catch(function(){});
  }
  if(closest(e.target,'[data-season]'))scheduleEpisodePatch();
},true);

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!timelineFocused())return;
  if(code!==37&&code!==39&&code!==412&&code!==417)return;
  try{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()}catch(_){}
  timelineSeek((code===39||code===417)?10000:-10000);
  return false;
},true);

if(typeof MutationObserver!=='undefined'){
  var details=$('#details');
  if(details){new MutationObserver(function(){scheduleEpisodePatch()}).observe(details,{childList:true,subtree:true})}
}
})();
