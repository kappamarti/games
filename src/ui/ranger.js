// Finestra del controllo del Corpo Forestale.
import { el } from './dom.js';
import { rulesSummary } from '../game/rules.js';

export function openRangerCheck(result, rangerName, where = 'sentiero') {
  return new Promise((resolve) => {
    const z = result.zone;
    const ov = el('div', { class: 'modal-backdrop' });
    const box = el('div', { class: 'modal ranger-modal' },
      el('div', { class: 'ranger-head' }, el('span', { class: 'ranger-badge' }, '🛡'), el('div', {},
        el('h3', {}, 'Controllo del Corpo Forestale'),
        el('small', { class: 'muted' }, `${rangerName} • ${where === 'parcheggio' ? 'controllo al parcheggio' : z.name}`))),
      el('p', {}, result.passed ? '«Buongiorno, controllo di routine. Mi mostra permesso e cestino?»' : '«Buongiorno. Vediamo un po\' cosa ha raccolto…»'),
      el('ul', { class: 'checks' }, result.checks.map((c) => el('li', { class: c.ok ? 'ok' : 'ko' }, `${c.ok ? '✓' : '✗'} ${c.text}`))),
      result.passed
        ? el('p', { class: 'ok' }, '«Tutto in regola. Buona raccolta e attenzione al meteo!» (+2 reputazione)')
        : el('div', {},
          el('p', { class: 'ko' }, `Verbale: multa di ${result.fine} €${result.confiscate.size ? `, ${result.confiscate.size} esemplari sequestrati` : ''}.`),
          el('p', { class: 'muted' }, `Regole della zona: ${rulesSummary(z).join(' • ')}`)),
      el('div', { class: 'row end' }, el('button', { class: 'btn primary', onclick: () => { ov.remove(); resolve(); } }, 'Ok')));
    ov.append(box);
    document.body.append(ov);
  });
}
