(function(){
'use strict';

window.HOME_CINEMA_RC='rc3.9-cinematic-ui';

var runtime=window.HOME_CINEMA_RC37_RUNTIME||{};
var pending=false;

function $(selector,root){return (root||document).querySelector(selector)}
function $$(selector,root){return Array.prototype.slice.call((root||document).querySelectorAll(selector))}
function text(value){return String(value==null?'':value).trim()}
function titleOf(item){return text(item&&(item.recognized_title||item.original_title||item.title))}
function mappedImage(value){
  value=text(value);if(!value)return '';
  var map=window.HOME_CINEMA_IMAGE_MAP||{};
  return map[value]||value;
}
function catalog(){return runtime.catalog||{movies:[],shows:[]}}
function itemForCard(card){
  if(!card)return null;
  var id=Number(card.getAttribute('data-id')||0),type=card.getAttribute('data-card-type'),items=type==='show'?(catalog().shows||[]):(catalog().movies||[]);
  for(var i=0;i<items.length;i++)if(Number(items[i].id)===id)return items[i];
  return null;
}
function focusedHeroItem(){
  var focused=$('.media-card.focused[data-card-type]');
  if(focused){var x=itemForCard(focused);if(x)return x}
  var currentTitle=text($('#heroTitle')&&$('#heroTitle').textContent),c=catalog(),all=(c.movies||[]).concat(c.shows||[]);
  for(var i=0;i<all.length;i++)if(titleOf(all[i])===currentTitle)return all[i];
  return null;
}
function decorateCard(card){
  var item=itemForCard(card);if(!item)return;
  var thumb=$('.media-thumb',card);if(!thumb)return;
  var backdrop=mappedImage(item.backdrop_url||item.poster_url||'');
  if(backdrop)thumb.style.backgroundImage="url('"+backdrop.replace(/'/g,"%27")+"')";
  if(Number(item.rating||0)>0&&!$('.cin-card-rating',thumb)){
    var badge=document.createElement('span');badge.className='cin-card-rating';badge.textContent=Number(item.rating).toFixed(1);thumb.appendChild(badge);
  }
}
function heroMeta(item){
  var meta=$('#heroMeta');if(!meta)return;
  if(item){
    var parts=[];
    if(Number(item.rating||0)>0)parts.push('<span class="cin-meta-rating">'+Number(item.rating).toFixed(1)+'</span>');
    if(item.year)parts.push('<span class="cin-meta-part">'+item.year+'</span>');
    if(item.genres)parts.push('<span class="cin-meta-part cin-meta-muted">'+text(item.genres)+'</span>');
    if(Number(item.season_count||0)>0)parts.push('<span class="cin-meta-part">'+Number(item.season_count)+' '+(Number(item.season_count)===1?'сезон':'сез.')+'</span>');
    if(parts.length){meta.innerHTML=parts.join('');return}
  }
  if($('.cin-meta-part,.cin-meta-rating',meta))return;
  var raw=text(meta.textContent);if(!raw)return;
  var source=raw.split('·'),html=[];
  for(var i=0;i<source.length;i++){
    var p=text(source[i]),m=p.match(/★\s*([0-9.]+)/);
    if(!p)continue;
    if(m)html.push('<span class="cin-meta-rating">'+m[1]+'</span>');
    else html.push('<span class="cin-meta-part">'+p+'</span>');
  }
  if(html.length)meta.innerHTML=html.join('');
}
function decorateHero(){heroMeta(focusedHeroItem())}
function decorateHeadings(){
  var movie=$('#movieSection h2'),show=$('#showSection h2'),cont=$('#continueSection h2');
  if(movie)movie.textContent='Фильмы для вас';
  if(show)show.textContent='Сериалы на основе вашей медиатеки';
  if(cont)cont.textContent='Продолжить просмотр';
}
function decorate(){
  pending=false;
  decorateHeadings();
  var cards=$$('.media-card[data-card-type]');
  for(var i=0;i<cards.length;i++)decorateCard(cards[i]);
  decorateHero();
}
function schedule(){
  if(pending)return;pending=true;
  window.setTimeout(decorate,20);
}

if(typeof MutationObserver==='function'){
  var observer=new MutationObserver(schedule);
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style']});
}

document.addEventListener('focusin',function(e){if(e&&e.target&&e.target.classList&&e.target.classList.contains('media-card'))schedule()},true);
document.addEventListener('click',schedule,true);
window.setInterval(function(){if(!runtime.catalog)schedule()},1800);
schedule();
})();
