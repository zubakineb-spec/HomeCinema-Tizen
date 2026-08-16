'use strict';

const fs = require('fs');

function read(path) { return fs.readFileSync(path, 'utf8'); }
function need(text, marker, label) {
  if (text.indexOf(marker) < 0) throw new Error(label + ': missing ' + marker);
}

const index = read('tv-app/index.html');
const css = read('tv-app/css/rc317-regression-fixes.css');
const models = read('native-qnap-d1/internal/app/models.go');
const server = read('native-qnap-d1/internal/app/server.go');
const ux = read('native-qnap-d1/internal/app/ux_api.go');

need(index, 'css/rc317-regression-fixes.css', 'index');
need(css, '#subtitleText:empty', 'subtitle strip guard');
need(css, 'display:none!important', 'subtitle strip guard');
need(css, 'background:transparent!important', 'subtitle strip guard');

need(models, 'RecognizedTitle', 'localized title model');
need(models, 'json:"recognized_title,omitempty"', 'localized title json');
need(server, 'st.Movies[i].RecognizedTitle = d.Title', 'movie RU title');
need(server, 'st.Shows[i].RecognizedTitle = d.Name', 'show RU title');
need(server, 'strings.TrimSpace(st.Movies[i].RecognizedTitle) != ""', 'movie migration');
need(server, 'strings.TrimSpace(st.Shows[i].RecognizedTitle) == ""', 'show migration');
need(server, 'items := continueItems(s.store.Snapshot())', 'continue endpoint');

need(ux, 'func continueItems(st State)', 'series-aware continue');
need(ux, 'historyItems(st, true)', 'completed progress awareness');
need(ux, 'seenShows := map[int]bool{}', 'one card per series');
need(ux, 'nextEpisodeAfter', 'completed episode advance');
need(ux, 'preferredDisplayTitle', 'localized continue title');

console.log('RC3.17 regression smoke: PASS');
