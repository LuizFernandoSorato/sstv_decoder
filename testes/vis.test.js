import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODOS } from '../src/modos.js';
import { sintetizar, tonsVis } from '../src/codificador.js';
import { decodificarTudo, adicionarRuido } from './auxiliares.js';

test('detecta o VIS de todos os modos', () => {
  for (const modo of MODOS) {
    const audio = sintetizar(tonsVis(modo.vis), 48000);
    const { modos } = decodificarTudo(audio, 48000);
    assert.equal(modos.length, 1, modo.id);
    assert.equal(modos[0].modo.id, modo.id);
    assert.equal(modos[0].origem, 'vis');
  }
});

test('detecta o VIS a 44,1 kHz e 22,05 kHz', () => {
  for (const taxa of [44100, 22050]) {
    const { modos } = decodificarTudo(sintetizar(tonsVis(44), taxa), taxa);
    assert.equal(modos[0]?.modo.id, 'martin-m1', `taxa ${taxa}`);
  }
});

test('estima o erro de sintonia pelo leader', () => {
  const audio = sintetizar(tonsVis(60), 48000, { desvioFrequencia: 90 });
  const { modos } = decodificarTudo(audio, 48000);
  assert.equal(modos[0]?.modo.id, 'scottie-s1');
  assert.ok(Math.abs(modos[0].desvio - 90) < 10, `desvio ${modos[0].desvio}`);
});

test('ruído puro não gera VIS falso', () => {
  const ruido = adicionarRuido(new Float32Array(48000 * 20), 0.3, 7);
  assert.equal(decodificarTudo(ruido, 48000).modos.length, 0);
});
