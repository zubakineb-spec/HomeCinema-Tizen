// Backend address used by the installed Samsung Tizen package.
window.HOME_CINEMA_API = window.HOME_CINEMA_API || 'http://192.168.0.101:8096';

// Samsung UE49NU7500U compatibility profile (2018 / Tizen 4.0 / Chromium M56).
// 2018 Samsung TVs do not decode DTS. Compatible streams stay direct; DTS-only streams use backend HLS fallback.
(function () {
    'use strict';
    var apiBase = window.HOME_CINEMA_API || '';
    var nativeJson = window.Response && Response.prototype.json;

    function isMediaSource(value) {
        return typeof value === 'string' && /^https?:\/\//i.test(value) && value.indexOf('/api/playback/smart?') < 0;
    }
    function smartUrl(value) {
        if (!isMediaSource(value)) return value;
        return apiBase.replace(/\/$/, '') + '/api/playback/smart?source_url=' + encodeURIComponent(value);
    }
    function rewriteSources(value) {
        if (!value || typeof value !== 'object') return value;
        if (Object.prototype.toString.call(value) === '[object Array]') {
            for (var i = 0; i < value.length; i++) rewriteSources(value[i]);
            return value;
        }
        for (var key in value) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
            if (key === 'source_url' && isMediaSource(value[key])) value[key] = smartUrl(value[key]);
            else rewriteSources(value[key]);
        }
        return value;
    }
    if (nativeJson) {
        Response.prototype.json = function () {
            var response = this;
            return nativeJson.call(response).then(function (data) {
                if (response.url && response.url.indexOf('/api/') >= 0) rewriteSources(data);
                return data;
            });
        };
    }

    function parseExtra(value) { try { return JSON.parse(value || '{}'); } catch (_) { return {}; } }
    function isDts(info) {
        var extra = parseExtra(info && info.extra_info);
        var codec = String(extra.fourCC || '').toUpperCase();
        return codec.indexOf('DTS') >= 0 || codec.indexOf('DCA') >= 0;
    }
    function selectCompatibleAudio(avplay) {
        try {
            var total = avplay.getTotalTrackInfo() || [];
            var current = avplay.getCurrentStreamInfo() || [];
            var selected = null;
            for (var i = 0; i < current.length; i++) if (current[i].type === 'AUDIO') selected = current[i];
            if (selected && !isDts(selected)) return;
            for (var j = 0; j < total.length; j++) {
                if (total[j].type === 'AUDIO' && !isDts(total[j])) {
                    avplay.setSelectTrack('AUDIO', Number(total[j].index));
                    return;
                }
            }
        } catch (e) { if (window.console) console.warn('NU7500 audio selection', e); }
    }
    function patchAvPlay() {
        try {
            if (!window.webapis || !webapis.avplay || webapis.avplay.__hcNu7500Patched) return;
            var avplay = webapis.avplay;
            var nativePrepareAsync = avplay.prepareAsync;
            avplay.prepareAsync = function (success, error) {
                return nativePrepareAsync.call(avplay, function () {
                    selectCompatibleAudio(avplay);
                    if (success) success();
                }, error);
            };
            avplay.__hcNu7500Patched = true;
        } catch (e) { if (window.console) console.warn('NU7500 AVPlay patch', e); }
    }
    patchAvPlay();

    window.addEventListener('load', function () {
        patchAvPlay();
        var aboutButton = document.querySelector('[data-view="about"]');
        var aboutOverlay = document.getElementById('aboutOverlay');
        var aboutBack = document.getElementById('aboutBack');
        var homeButton = document.querySelector('[data-view="home"]');
        if (!aboutButton || !aboutOverlay || !aboutBack) return;
        function openAbout() { aboutOverlay.classList.remove('hidden'); try { aboutBack.focus(); } catch (_) {} }
        function closeAbout() {
            aboutOverlay.classList.add('hidden');
            if (homeButton) { homeButton.click(); try { homeButton.focus(); } catch (_) {} }
        }
        aboutButton.addEventListener('click', openAbout);
        aboutBack.addEventListener('click', closeAbout);
        document.addEventListener('keydown', function (event) {
            if (aboutOverlay.classList.contains('hidden')) return;
            if (event.keyCode === 13 || event.keyCode === 10009 || event.keyCode === 27) {
                event.preventDefault(); event.stopPropagation(); closeAbout();
            }
        });
    });
})();
