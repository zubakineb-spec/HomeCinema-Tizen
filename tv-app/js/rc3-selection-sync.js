(function(){
'use strict';

var API=window.HOME_CINEMA_API||'http://192.168.0.101:8096';
var catalog={movies:[],shows:[]};
var heroSelection=null;

function $(s,root){return (root||document).querySelector(s)}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function api(path){return fetch(API.replace(/\/$/,'')+path).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})}
function itemScore(item){
  var rating=Number(item&&item.rating||0),year=Number(item&&item.year||0),score=rating*100;
  if(item&&(item.backdrop_url||item.poster_url))score+=30;
  if(item&&String(item.overview||'').trim())score+=20;
  if(year>0)score+=Math.min(20,Math.max(0,(year-2000)/2));
  return score;
}
function initialSelection(c){
  var all=[],i;
  for(i=0;i<(c.movies||[]).length;i++)all.push({type:'movie',item:c.movies[i]});
  for(i=0;i<(c.shows||[]).length;i++)all.push({type:'show',item:c.shows[i]});
  if(!all.length)return null;
  all.sort(function(a,b){return itemScore(b.item)-itemScore(a.item)});
  return {type:all[0].type,id:Number(all[0].item.id)};
}
function selectionFromCard(card){
  if(!card)return null;
  var type=card.getAttribute('data-card-type'),id=Number(card.getAttribute('data-id')||0);
  if((type!=='movie'&&type!=='show')||!id)return null;
  return {type:type,id:id};
}
function rememberHomeCard(target){
  var card=closest(target,'[data-card-type][data-id]');
  if(!card)return;
  var home=$('#homeScreen');
  if(!home||!home.contains(card))return;
  var next=selectionFromCard(card);
  if(next)heroSelection=next;
}
function findCard(sel){
  if(!sel)return null;
  return $('#homeScreen [data-card-type="'+sel.type+'"][data-id="'+sel.id+'"]');
}
function clickDetailPlay(tries){
  var button=$('#detailPlay');
  if(button){button.click();return}
  if(tries>0)setTimeout(function(){clickDetailPlay(tries-1)},100);
}
function heroAction(e){
  var button=closest(e.target,'#heroPlay')||closest(e.target,'#heroInfo');
  if(!button||!heroSelection)return;
  var card=findCard(heroSelection);
  if(!card)return;

  try{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()}catch(_){}

  /*
   * Always route through the exact card that owns the currently displayed hero.
   * This keeps app.js state.current / state.heroItem and the seriesArea source ID
   * on the same movie/show instead of relying on an older private heroItem value.
   */
  card.click();
  if(button.id==='heroPlay')clickDetailPlay(20);
  return false;
}

api('/api/catalog').then(function(c){
  catalog=c||{movies:[],shows:[]};
  heroSelection=initialSelection(catalog);
}).catch(function(){});

document.addEventListener('focusin',function(e){rememberHomeCard(e.target)},true);
document.addEventListener('click',function(e){
  if(heroAction(e)===false)return false;
  rememberHomeCard(e.target);
},true);
})();
