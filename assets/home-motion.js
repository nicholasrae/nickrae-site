/* Optional homepage motion. No storage, analytics or provider interaction. */
(() => {
  'use strict';
  const stage = document.querySelector('.cover-stage[data-home-artwork]');
  if (!stage || typeof window.matchMedia !== 'function') return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let playingRevision = 0;

  function syncMotion() {
    const revision = ++playingRevision;
    const enabled = !preference.matches;
    document.body.classList.toggle('home-motion-on', enabled);
    document.body.classList.toggle('home-motion-off', !enabled);
    stage.classList.remove('is-playing');
    if (!enabled) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (revision === playingRevision && !preference.matches) stage.classList.add('is-playing');
    }));
  }

  if (typeof preference.addEventListener === 'function') preference.addEventListener('change', syncMotion);
  else if (typeof preference.addListener === 'function') preference.addListener(syncMotion);
  syncMotion();
})();
