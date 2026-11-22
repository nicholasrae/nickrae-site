const toggle = document.getElementById('sideslip-toggle');
const diagram = document.getElementById('sideslip-diagrams');
const interactive = document.getElementById('sideslip-interactive');
const container = document.getElementById('sideslip-scene');
const presets = document.getElementById('sideslip-presets');
const status = document.getElementById('sideslip-message');
let model = null;
let opened = false;

function showDiagram(message = '') {
  if (model) model.dispose();
  model = null;
  interactive.hidden = true;
  presets.hidden = true;
  diagram.hidden = false;
  toggle.textContent = 'Explore in 3D';
  toggle.setAttribute('aria-expanded', 'false');
  status.textContent = message;
}

function selectView(view) {
  model.setView(view);
  for (const button of presets.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
}

toggle.hidden = false;
toggle.addEventListener('click', async () => {
  if (model) {
    showDiagram();
    return;
  }
  toggle.disabled = true;
  toggle.textContent = 'Loading 3D model…';
  status.textContent = '';
  try {
    const {createModel} = await import('./zero-sideslip-model.js');
    interactive.hidden = false;
    model = createModel(container);
    diagram.hidden = true;
    presets.hidden = false;
    for (const button of presets.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.view === 'quarter'));
    }
    toggle.textContent = 'Show diagram';
    toggle.setAttribute('aria-expanded', 'true');
  } catch {
    showDiagram('The 3D view could not load. The two labeled diagrams below show the same example.');
    return;
  } finally {
    toggle.disabled = false;
  }
  if (!opened) {
    opened = true;
    window.NickRaeMeasurement?.track('zero_sideslip_model_open', {
      event_category: 'workbook', product: 'multi_engine_workbook', placement: 'zero-sideslip-demo'
    });
  }
});

presets.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (model && button) selectView(button.dataset.view);
});
container.addEventListener('sideslip-model-lost', () => showDiagram('The 3D view was interrupted. You can reopen it or use the diagrams below.'));
container.addEventListener('sideslip-model-orbit', () => {
  for (const button of presets.querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
});
