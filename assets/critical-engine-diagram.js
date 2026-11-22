// Plan view is nose-up. Positive x is the pilot's right.
export function updateCriticalDiagram(svg, state) {
  const {aircraft, failed, operatingSign, descendingSign, longArm} = state;
  const failedSign = -operatingSign;
  const engineX = operatingSign * 72;
  const thrustX = engineX + descendingSign * 18;
  const halfArm = thrustX / 2;
  const conventional = aircraft === 'conventional';
  const operating = failed === 'left' ? 'right' : 'left';
  const armLabel = conventional ? (longArm ? 'Longer arm' : 'Shorter arm') : 'Equal arm';
  const path = (name, value) => svg.querySelector(`[data-cue="${name}"]`).setAttribute('d', value);
  const transform = (name, value) => svg.querySelector(`[data-cue="${name}"]`).setAttribute('transform', value);

  function label(name, x, text, anchor = 'middle') {
    const el = svg.querySelector(`[data-cue="${name}"]`);
    el.setAttribute('x', x);
    el.setAttribute('text-anchor', anchor);
    el.textContent = text;
  }

  transform('failed', `translate(${-engineX} 0)`);
  transform('out-leader', `scale(${failedSign} 1)`);
  label('out-label', failedSign * 115, failed === 'left' ? 'Left out' : 'Right out', failedSign < 0 ? 'end' : 'start');
  transform('thrust', `translate(${thrustX} 0)`);
  label('thrust-label', thrustX, 'Thrust');
  transform('yaw', `scale(${failedSign} 1)`);
  label('yaw-label', failedSign * 87, `Yaw ${failed}`);
  path('arm-outline', `M0 177H${thrustX}`);
  path('arm', `M0 177H${thrustX}`);
  path('corner', `M${thrustX - operatingSign * 7} 177v-7h${operatingSign * 7}`);
  path('arm-leader', `M${halfArm} 183v8L${operatingSign * 66} 207h${operatingSign * 9}`);
  label('arm-label', operatingSign * 79, armLabel, operatingSign > 0 ? 'start' : 'end');
  transform('cg-leader', `scale(${failedSign} 1)`);
  label('cg-label', failedSign * 38, 'CG', failedSign < 0 ? 'end' : 'start');

  const type = conventional ? 'conventional twin' : 'Seminole';
  const shift = longArm ? 'outboard' : 'inboard';
  const comparison = conventional
    ? `The remaining thrust has a ${longArm ? 'longer' : 'shorter'} moment arm than when the other engine fails.`
    : 'The moment arm is the same length when either engine fails.';
  svg.querySelector('desc').textContent = `Nose up. The ${type} has its ${failed} engine out. The effective thrust line is ${shift} of the operating ${operating} propeller hub. ${comparison} The nose tends to yaw ${failed}.`;
}
