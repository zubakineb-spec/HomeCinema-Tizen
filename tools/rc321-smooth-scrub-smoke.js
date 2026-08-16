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

function classList(initial){
  const set=new Set(initial||[]);
  return {
    contains:v=>set.has(v),
    add:v=>set.add(v),
    remove:v=>set.delete(v)
  };
}
function element(id,classes){
  const children={};
  return {
    id,
    classList:classList(classes),
    style:{},
    textContent:'',
    appendChild:function(x){children['#'+x.id]=x},
    querySelector:function(s){return children[s]||null},
    focus:function(){document.activeElement=this},
    blur:function(){if(document.activeElement===this)document.activeElement=null}
  };
}

const player=element('player',[]);
const chrome=element('playerChrome',['hidden']);
const settings=element('playerSettings',['hidden']);
const timeline=element('playerTimelineButton',[]);
const stateText=element('playerStateText',[]);
const elements={
  '#player':player,
  '#playerChrome':chrome,
  '#playerSettings':settings,
  '#playerTimelineButton':timeline,
  '#playerStateText':stateText
};
const document={
  activeElement:null,
  querySelector:function(s){return elements[s]||null},
  querySelectorAll:function(){return []},
  createElement:function(){return element('',[])}
};

const listeners={};
let intervalFn=null;
let avState='PLAYING';
let jumpForwardValue=null;
let pauseCalls=0;
let playCalls=0;
const avplay={
  getState:function(){return avState},
  getCurrentTime:function(){return 100000},
  getDuration:function(){return 1000000},
  pause:function(){pauseCalls++;avState='PAUSED'},
  play:function(){playCalls++;avState='PLAYING'},
  jumpForward:function(v,ok){jumpForwardValue=v;if(ok)ok()},
  jumpBackward:function(v,ok){if(ok)ok()},
  seekTo:function(v,ok){if(ok)ok()}
};
const sandbox={
  window:{
    setInterval:function(fn){intervalFn=fn;return 1},
    clearInterval:function(){intervalFn=null},
    setTimeout:function(){return 1},
    clearTimeout:function(){},
    addEventListener:function(name,fn){listeners[name]=fn}
  },
  document:document,
  webapis:{avplay:avplay},
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

function event(code){return {keyCode:code,preventDefault:function(){},stopPropagation:function(){},stopImmediatePropagation:function(){}}}
listeners.keydown(event(39));
if(pauseCalls!==1||avState!=='PAUSED')fail('smooth scrub must pause playback while selecting position');
if(chrome.classList.contains('hidden'))fail('smooth scrub must reveal the timeline');
if(typeof intervalFn!=='function')fail('smooth scrub frame loop was not started');
listeners.keyup(event(39));
if(jumpForwardValue===null)fail('right-arrow release did not commit an AVPlay jump');
if(jumpForwardValue<1400||jumpForwardValue>2500)fail('short right-arrow tap should be a fine ~1.5-2.5 second move, got '+jumpForwardValue+'ms');
if(jumpForwardValue===10000)fail('short tap still performs the old fixed +10 second jump');
if(playCalls!==1||avState!=='PLAYING')fail('playback must resume after committed smooth scrub');

console.log('PASS: Left/Right smooth scrub uses 50ms visual updates instead of fixed 10-second jumps');
console.log('PASS: frame-time arithmetic is scaled correctly');
console.log('PASS: short Right tap commits a fine-grained move, not +10 seconds');
console.log('PASS: hold acceleration progresses 4.5 -> 12 -> 30 -> 60 seconds per second');
console.log('PASS: one AVPlay jump is committed on key release');
console.log('PASS: RC3.19 Continue recovery remains intact');
console.log('HOME_CINEMA_RC321_SMOOTH_SCRUB_SMOKE=PASS');
