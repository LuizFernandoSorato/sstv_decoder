import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODOS, MODO_POR_VIS, buscarModo } from '../src/modos.js';

// Período de uma unidade de varredura em ms, conforme as especificações.
const PERIODOS = {
  'martin-m1': 446.446,
  'martin-m2': 226.798,
  'scottie-s1': 428.22,
  'scottie-s2': 277.692,
  'scottie-dx': 1050.3,
  'robot-36': 300, // 2 linhas de 150 ms
  'robot-72': 300,
  'pd-90': 703.04,
  'pd-120': 508.48,
  'pd-180': 770.88,
};

test('períodos batem com as especificações', () => {
  for (const modo of MODOS) {
    assert.ok(Math.abs(modo.periodo - PERIODOS[modo.id]) < 1e-9, `${modo.id}: ${modo.periodo}`);
  }
});

test('códigos VIS são únicos e cabem em 7 bits', () => {
  assert.equal(MODO_POR_VIS.size, MODOS.length);
  for (const modo of MODOS) assert.ok(modo.vis >= 0 && modo.vis < 128);
});

test('altura é múltipla das linhas por unidade', () => {
  for (const modo of MODOS) assert.equal(modo.altura % modo.linhasPorUnidade, 0, modo.id);
});

test('posição do sync no Scottie fica antes do canal vermelho', () => {
  assert.ok(Math.abs(buscarModo('scottie-s1').deslocSync - 279.48) < 1e-9);
  assert.equal(buscarModo('martin-m1').deslocSync, 0);
});
