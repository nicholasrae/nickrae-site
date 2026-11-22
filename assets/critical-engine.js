import {updateCriticalDiagram} from './critical-engine-diagram.js';

const section = document.getElementById('critical-engine');
const controls = section.querySelector('#critical-settings');
const diagram = section.querySelector('#critical-diagram');
const toggle = section.querySelector('#critical-toggle');
const modelPanel = section.querySelector('#critical-model-panel');
const scene = section.querySelector('#critical-scene');
const presets = section.querySelectorAll('[data-critical-view]');
const message = section.querySelector('#critical-message');
const resultTitle = section.querySelector('#critical-result-title');
const resultText = section.querySelector('#critical-result-text');
let model = null;

function selectedState() {
  const aircraft = controls.querySelector('[name="critical-aircraft"]:checked').value;
  const failed = controls.querySelector('[name="critical-failed"]:checked').value;
  const operatingSign = failed === 'left' ? 1 : -1;
  // From the pilot's perspective a clockwise propeller descends on its right.
  const descendingSign = aircraft === 'seminole' ? -operatingSign : 1;
  return {aircraft, failed, operatingSign, descendingSign, longArm: operatingSign === descendingSign};
}

function refresh() {
  const state = selectedState();
  const operating = state.operatingSign === 1 ? 'right' : 'left';
  const capitalized = state.failed === 'left' ? 'Left' : 'Right';
  resultTitle.textContent = capitalized + ' engine out · nose tends ' + state.failed;
  if (state.aircraft === 'seminole') {
    resultText.textContent = 'The ' + operating + ' propeller’s descending blade is inboard. Switching the failed engine gives the same thrust arm and an equal yawing moment in the opposite direction. Neither engine is critical.';
  } else if (state.longArm) {
    resultText.textContent = 'The right propeller’s descending blade is outboard. Its thrust acts farther from the center of gravity, producing the larger yawing moment. The left engine is critical on this twin.';
  } else {
    resultText.textContent = 'The left propeller’s descending blade is inboard. Its thrust acts closer to the center of gravity, producing a smaller yawing moment than when the left engine fails.';
  }
  updateCriticalDiagram(diagram, state);
  model?.setState(state);
}

function markView(name) {
  for (const button of presets) {
    button.setAttribute('aria-pressed', String(button.dataset.criticalView === name));
  }
}

function showDiagram(notice = '') {
  model?.dispose();
  model = null;
  modelPanel.hidden = true;
  diagram.removeAttribute('hidden');
  toggle.textContent = 'View in 3D';
  toggle.setAttribute('aria-expanded', 'false');
  message.textContent = notice;
}

toggle.addEventListener('click', async () => {
  if (model) {
    showDiagram();
    return;
  }
  toggle.disabled = true;
  toggle.textContent = 'Loading model…';
  message.textContent = '';
  try {
    const {createCriticalModel} = await import('./critical-engine-model.js');
    modelPanel.hidden = false;
    model = createCriticalModel(scene, selectedState(), 'propellers');
    markView('propellers');
    diagram.setAttribute('hidden', '');
    toggle.textContent = 'Return to diagram';
    toggle.setAttribute('aria-expanded', 'true');
  } catch {
    showDiagram('The 3D view is unavailable. You can still compare both aircraft and engine failures in the diagram.');
  } finally {
    toggle.disabled = false;
  }
});

for (const button of presets) {
  button.addEventListener('click', () => {
    if (!model) return;
    model.setView(button.dataset.criticalView);
    markView(button.dataset.criticalView);
  });
}
scene.addEventListener('critical-engine-orbit', () => markView(null));
scene.addEventListener('critical-engine-lost', () => {
  showDiagram('The 3D view was interrupted. The diagram shows your selected aircraft and engine.');
});
controls.addEventListener('change', refresh);
refresh();
controls.hidden = false;
toggle.hidden = false;
