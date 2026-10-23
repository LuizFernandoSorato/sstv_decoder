import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarModo } from '../src/modos.js';
import { codificar } from '../src/codificador.js';
import { padraoDeTeste } from '../ferramentas/sinal-teste.js';
import { decodificarTudo, psnr, adicionarRuido } from './auxiliares.js';

const TAXA = 48000;
const MARGEM = 4;

function idaEVolta(idModo, { taxaCodificacao = TAXA, taxaDecodificacao = TAXA, ruido = 0, modoManual = null, ...opcoes } = {}) {
  const modo = buscarModo(idModo);
  const original = padraoDeTeste(modo.largura, modo.altura);
  let audio = codificar(modo, original, taxaCodificacao, opcoes);
  if (ruido) audio = adicionarRuido(audio, ruido);
  const resultado = decodificarTudo(audio, taxaDecodificacao, { modo: modoManual });
  return { modo, original, ...resultado };
}

test('corrige a inclinação de um relógio 0,5% fora', () => {
  // Codificado a 48240 Hz e lido como 48000 Hz: as linhas ficam 0,5% mais longas.
  const { original, imagens } = idaEVolta('martin-m1', { taxaCodificacao: 48240 });
  const [imagem] = imagens;
  assert.ok(Math.abs(imagem.relogio - 1.005) < 0.0005, `relógio ${imagem.relogio}`);
  const valor = psnr(original.dados, imagem.imagem, 320, { margem: MARGEM });
  assert.ok(valor >= 30, `PSNR ${valor.toFixed(1)} dB`);
});

test('compensa erro de sintonia de +80 Hz', () => {
  const { original, imagens } = idaEVolta('robot-36', { desvioFrequencia: 80 });
  const valor = psnr(original.dados, imagens[0].imagem, 320, { margem: MARGEM });
  assert.ok(valor >= 30, `PSNR ${valor.toFixed(1)} dB`);
});

test('decodifica com ruído forte', () => {
  // amplitude do sinal 0,5 com ruído σ=0,35: SNR ≈ 0 dB na banda inteira de
  // 24 kHz, ~9 dB dentro da banda do demodulador
  const { original, imagens } = idaEVolta('scottie-s1', { ruido: 0.35 });
  assert.equal(imagens.length, 1);
  assert.equal(imagens[0].modo.id, 'scottie-s1');
  assert.ok(imagens[0].sincronismos >= 250, `syncs ${imagens[0].sincronismos}`);
  const valor = psnr(original.dados, imagens[0].imagem, 320, { margem: MARGEM });
  assert.ok(valor >= 18, `PSNR ${valor.toFixed(1)} dB`);
});

test('modo manual decodifica sinal sem VIS', () => {
  const { original, imagens, modos } = idaEVolta('pd-120', { comVis: false, modoManual: 'pd-120' });
  assert.equal(modos[0]?.origem, 'sync');
  assert.equal(imagens.length, 1);
  const valor = psnr(original.dados, imagens[0].imagem, 640, { margem: MARGEM, linhas: 490 });
  assert.ok(valor >= 30, `PSNR ${valor.toFixed(1)} dB`);
});

test('arquivo cortado no meio entrega a imagem parcial', () => {
  const modo = buscarModo('martin-m1');
  const original = padraoDeTeste(320, 256);
  const audio = codificar(modo, original, TAXA);
  const { imagens } = decodificarTudo(audio.subarray(0, Math.round(audio.length * 0.5)), TAXA);
  assert.equal(imagens.length, 1);
  assert.ok(imagens[0].linhas > 100 && imagens[0].linhas < 140, `linhas ${imagens[0].linhas}`);
  const valor = psnr(original.dados, imagens[0].imagem, 320, { margem: MARGEM, linhas: 100 });
  assert.ok(valor >= 35, `PSNR ${valor.toFixed(1)} dB`);
});

test('duas imagens seguidas no mesmo áudio', () => {
  const robot = buscarModo('robot-36');
  const martin = buscarModo('martin-m2');
  const audio = Float32Array.from([
    ...codificar(robot, padraoDeTeste(320, 240), TAXA),
    ...codificar(martin, padraoDeTeste(320, 256), TAXA),
  ]);
  const { imagens } = decodificarTudo(audio, TAXA);
  assert.deepEqual(imagens.map((imagem) => imagem.modo.id), ['robot-36', 'martin-m2']);
});
