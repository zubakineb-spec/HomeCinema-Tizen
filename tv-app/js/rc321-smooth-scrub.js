(function(){
'use strict';

/* RC3.24: keep the retired RC3.21 compatibility layer inert.
 *
 * The sole timeline implementation lives in rc32-player-navigation.js:
 *   Up -> timeline
 *   Left/Right -> select target only
 *   repeated keydown -> confirms hold
 *   internal clock -> smooth accelerated target motion
 *   keyup OR repeat stream silence -> exactly one absolute seekTo()
 *
 * No remote listeners or AVPlay calls are registered here.
 */
var hint=null;
try{hint=document.querySelector('.player-hint')}catch(_){}
if(hint)hint.textContent='↑ — шкала времени · удерживать ←/→ — выбрать позицию · отпустить — один переход · Назад — меню / выход';

window.HOME_CINEMA_RC321={
  marker:'rc3.24-rc321-retired',
  retired:true,
  owner:'rc32-player-navigation.js'
};
window.HOME_CINEMA_RC='rc3.24-samsung-release-detection';
})();
