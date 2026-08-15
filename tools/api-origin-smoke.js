'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'js', 'config.js'), 'utf8');
const calls = [];

const context = {
  window: {
    fetch(input, opts) {
      calls.push({input, opts});
      return Promise.resolve({ok: true});
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context);

assert.strictEqual(context.window.HOME_CINEMA_API, 'http://192.168.0.101:8096');

context.window.fetch('/api/catalog');
context.window.fetch('/api/continue', {method: 'GET'});
context.window.fetch('http://192.168.0.101:8096/media/movie.mkv');
context.window.fetch('https://image.tmdb.org/t/p/w500/poster.jpg');

assert.strictEqual(calls[0].input, 'http://192.168.0.101:8096/api/catalog');
assert.strictEqual(calls[1].input, 'http://192.168.0.101:8096/api/continue');
assert.strictEqual(calls[2].input, 'http://192.168.0.101:8096/media/movie.mkv');
assert.strictEqual(calls[3].input, 'https://image.tmdb.org/t/p/w500/poster.jpg');

console.log('PASS: explicit QNAP API is configured');
console.log('PASS: root-relative API calls are routed to QNAP');
console.log('PASS: absolute media/image URLs remain unchanged');
console.log('HOME_CINEMA_API_ORIGIN=PASS');
