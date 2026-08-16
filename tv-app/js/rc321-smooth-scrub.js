(function(){
'use strict';

/* RC3.22: retire the experimental RC3.21 direct-arrow scrubber.
 *
 * The proven timeline implementation already lives in rc32-player-navigation.js:
 *   Up -> timeline
 *   Left/Right -> select target position
 *   hold -> 10 / 30 / 60 second accelerated target steps
 *   keyup/OK -> exactly one absolute seekTo()
 *   Back -> cancel uncommitted target without stealing Back from app.js
 *
 * Keep this compatibility file in the package so older release/package layouts
 * remain stable, but deliberately register no remote handlers and touch no AVPlay.
 */
var hint=null;
try{hint=document.querySelector('.player-hint')}catch(_){}
if(hint)hint.textContent='↑ — шкала времени · удерживать ←/→ — выбрать позицию · отпустить — перейти · Назад — меню / выход';

window.HOME_CINEMA_RC321={
  marker:'rc3.22-rc321-retired',
  retired:true,
  owner:'rc32-player-navigation.js'
};
window.HOME_CINEMA_RC='rc3.22-restore-proven-scrub';
})();
