// When the UI is served by the backend in a browser, leave empty.
// For an installed Tizen package, set the LAN address of the Home Cinema backend.
window.HOME_CINEMA_API = window.HOME_CINEMA_API || 'http://192.168.0.101:8096';

// v0.2.1 compatibility bridge for the TMDB Credits/About overlay.
// Kept separate from the core navigation so the compliance patch does not alter playback logic.
window.addEventListener('load', function () {
    var aboutButton = document.querySelector('[data-view="about"]');
    var aboutOverlay = document.getElementById('aboutOverlay');
    var aboutBack = document.getElementById('aboutBack');
    var homeButton = document.querySelector('[data-view="home"]');

    if (!aboutButton || !aboutOverlay || !aboutBack) {
        return;
    }

    function openAbout() {
        aboutOverlay.classList.remove('hidden');
        try { aboutBack.focus(); } catch (_) {}
    }

    function closeAbout() {
        aboutOverlay.classList.add('hidden');
        if (homeButton) {
            homeButton.click();
            try { homeButton.focus(); } catch (_) {}
        }
    }

    aboutButton.addEventListener('click', openAbout);
    aboutBack.addEventListener('click', closeAbout);

    document.addEventListener('keydown', function (event) {
        if (aboutOverlay.classList.contains('hidden')) {
            return;
        }
        if (event.keyCode === 13 || event.keyCode === 10009 || event.keyCode === 27) {
            event.preventDefault();
            event.stopPropagation();
            closeAbout();
        }
    });
});
