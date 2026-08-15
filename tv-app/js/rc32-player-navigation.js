(function(){
'use strict';

var lastControl=null;

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function visible(el){return !!el&&!closest(el,'.hidden')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function timeline(){return $('#playerTimelineButton')}
function playerChromeVisible(){var c=$('#playerChrome');return !!c&&visible(c)}
function clearPlayerFocus(){$$('.player-focusable').forEach(function(x){x.classList.remove('focused')})}
function focusTimeline(){var t=timeline();if(!t)return;clearPlayerFocus();t.classList.add('focused');try{t.focus()}catch(_){}}
function focusControl(){
  var c=lastControl;
  if(!c||!document.documentElement.contains(c)||!visible(c))c=$('#playerToggleButton');
  if(!c)return;
  clearPlayerFocus();c.classList.add('focused');try{c.focus()}catch(_){}
}
function timelineFocused(){var t=timeline();return !!t&&(document.activeElement===t||t.classList.contains('focused'))}
function seek(delta){
  if(typeof webapis==='undefined'||!webapis.avplay)return;
  var av=webapis.avplay;
  try{
    var st=av.getState();if(st!=='PLAYING'&&st!=='PAUSED')return;
    var done=function(){focusTimeline()};
    if(delta>0)av.jumpForward(delta,done,function(){done()});
    else av.jumpBackward(Math.abs(delta),done,function(){done()});
    var text=$('#playerStateText');
    if(text){
      text.textContent=(delta>0?'+':'−')+Math.abs(delta/1000)+' сек';
      setTimeout(function(){if(text)text.textContent='Воспроизведение'},900);
    }
  }catch(e){try{console.warn('RC3.2 timeline seek failed',e)}catch(_){}}
}

document.addEventListener('focusin',function(e){
  var control=closest(e.target,'#playerControls .player-focusable');
  if(control)lastControl=control;
},true);

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!playerChromeVisible())return;

  if(timelineFocused()){
    if(code===37||code===412){consume(e);seek(-10000);return false}
    if(code===39||code===417){consume(e);seek(10000);return false}
    if(code===40){consume(e);focusControl();return false}
    if(code===38){consume(e);return false}
    return;
  }

  var active=closest(document.activeElement,'#playerControls .player-focusable');
  if(active&&code===38){
    lastControl=active;
    consume(e);
    focusTimeline();
    return false;
  }
},true);
})();
