/* Optional homepage motion. No storage, analytics or provider interaction. */
(() => {
  'use strict';
  const stage = document.querySelector('.cover-stage[data-home-artwork]');
  const controls = document.querySelector('[data-home-motion-controls]');
  if (!stage || !controls || typeof window.matchMedia !== 'function') return;
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const toggle = controls.querySelector('[data-motion-toggle]');
  const replay = controls.querySelector('[data-motion-replay]');
  const status = controls.querySelector('[data-motion-status]');
  if (!toggle || !replay || !status) return;
  let chosenMotion = true;
  let playingRevision = 0;
  const allowed = () => chosenMotion && !preference.matches;

  function play() {
    const revision = ++playingRevision;
    stage.classList.remove('is-playing');
    if (!allowed()) return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (revision === playingRevision && allowed()) stage.classList.add('is-playing');
    }));
  }

  function render() {
    const enabled = allowed();
    document.body.classList.toggle('home-motion-on', enabled);
    document.body.classList.toggle('home-motion-off', !enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'Motion on' : 'Motion off';
    toggle.disabled = preference.matches;
    replay.disabled = !enabled;
    status.textContent = preference.matches
      ? 'Your device requests reduced motion. Artwork and card previews remain available.'
      : enabled ? 'Artwork entrance plays once. Replay it here.'
        : 'Motion is off. The artwork and card preview still work.';
    if (!enabled) {
      playingRevision += 1;
      stage.classList.remove('is-playing');
    }
  }

  toggle.addEventListener('click', () => {
    chosenMotion = !chosenMotion;
    render();
    if (allowed()) play();
  });
  replay.addEventListener('click', play);
  const preferenceChanged = () => {
    render();
    if (allowed()) play();
  };
  if (typeof preference.addEventListener === 'function') preference.addEventListener('change', preferenceChanged);
  else if (typeof preference.addListener === 'function') preference.addListener(preferenceChanged);
  render();
  controls.hidden = false;
  play();
})();
