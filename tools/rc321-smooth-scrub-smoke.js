'use strict';

const fs = require('fs');
const vm = require('vm');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const smooth = fs.readFileSync('tv-app/js/rc321-smooth-scrub.js','utf8');
const index = fs.readFileSync('tv-app/index.html','utf8');
const rc319 = fs.readFileSync('tv-app/js/rc319-continue-recovery.js','utf8');

[
  "marker:'rc3.21-smooth-scrub'",
  'var FRAME_MS=50',
  'var INITIAL_NUDGE_MS=1500',
  'nativeSetInterval(tick,FRAME_MS)',
  'target=clamp(target+(direction*speed*dt/1000)',
  "if(delta>0&&typeof p.jumpForward==='function')",
  "if(delta<0&&typeof p.jumpBackward==='function')",
  "if(chromeVisible()&&!timelineFocused())return",
  'window.addEventListener(\'keyup\'',
  'consume(e);commit()'
].forEach(marker=>{if(!smooth.includes(marker))fail('missing smooth scrub marker: '+marker)});

if(smooth.includes('SCRUB_STEP=10000')||smooth.includes('target=origin+(dir*10000)')){
  fail('RC3.21 reintroduced fixed 10-second timeline jumps');
}
if(!smooth.includes('speed*dt/1000')){
  fail('scrub speed must be scaled from milliseconds-per-second to the 50ms frame duration');
}

const ix321=index.indexOf('js/rc321-smooth-scrub.js');
const ix32=index.indexOf('js/rc32-player-navigation.js');
const ix319=index.indexOf('js/rc319-continue-recovery.js');
const ixApp=index.indexOf('js/app.js');
if(ix321<0||ix32<0||ix319<0||ixApp<0||!(ix321<ix32&&ix32<ix319&&ix319<ixApp)){
  fail('RC3.21 must load before legacy timeline handlers while RC3.19 remains before app.js');
}

[
  'body.completed=completed?1:0',
  'body.rc319_progress_contract=319',
  'effectiveIncomplete',
  'mergeContinueData'
].forEach(marker=>{if(!rc319.includes(marker))fail('RC3.19 Continue recovery was not preserved: '+marker)});

const listeners={};
const sandbox={
  window:{
    setInterval:function(){return 1},
    clearInterval:function(){},
    setTimeout:function(){return 1},
    clearTimeout:function(){},
    addEventListener:function(name,fn){listeners[name]=fn}
  },
  document:{querySelector:function(){return null},querySelectorAll:function(){return []}},
  console:console,
  Date:Date,
  Math:Math,
  Number:Number,
  String:String,
  Array:Array,
  Object:Object,
  isFinite:isFinite
};
sandbox.window.window=sandbox.window;
vm.runInNewContext(smooth,sandbox,{filename:'rc321-smooth-scrub.js'});

const api=sandbox.window.HOME_CINEMA_RC321;
if(!api||api.marker!=='rc3.21-smooth-scrub')fail('runtime RC3.21 marker missing');
if(api.frameMs!==50||api.initialNudgeMs!==1500)fail('unexpected smooth scrub timing constants');
if(api.speedFor(0)!==4500)fail('initial scrub speed must be fine-grained');
if(api.speedFor(800)!==12000)fail('medium scrub acceleration missing');
if(api.speedFor(2200)!==30000)fail('fast scrub acceleration missing');
if(api.speedFor(5000)!==60000)fail('long-hold scrub acceleration missing');
if(typeof listeners.keydown!=='function'||typeof listeners.keyup!=='function')fail('remote key handlers not registered');

console.log('PASS: Left/Right smooth scrub uses 50ms visual updates instead of fixed 10-second jumps');
console.log('PASS: frame-time arithmetic is scaled correctly');
console.log('PASS: hold acceleration progresses 4.5 -> 12 -> 30 -> 60 seconds per second');
console.log('PASS: one AVPlay jump is committed on key release');
console.log('PASS: RC3.19 Continue recovery remains intact');
console.log('HOME_CINEMA_RC321_SMOOTH_SCRUB_SMOKE=PASS');
