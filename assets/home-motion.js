/* Homepage decoration only. Never gates content, forms or tracking. */
(() => {
  'use strict';
  if (!document.body.matches('[data-page="home"]')) return;
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
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (revision === playingRevision && !preference.matches) stage.classList.add('is-playing');
    }));
  }
  if (typeof preference.addEventListener === 'function') preference.addEventListener('change', syncMotion);
  else if (typeof preference.addListener === 'function') preference.addListener(syncMotion);
  syncMotion();
  const story = document.querySelector('[data-study-story]');
  if (!story || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    story.classList.add('is-in-view');
    observer.disconnect();
  }, { threshold: 0.15 });
  observer.observe(story);
})();
