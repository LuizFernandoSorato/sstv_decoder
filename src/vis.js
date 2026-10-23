// Detecção e leitura do código VIS (Vertical Interval Signaling).
//
// Leader 1900 Hz 300 ms → break 1200 Hz 10 ms → leader 1900 Hz 300 ms →
// start bit 1200 Hz 30 ms → 7 bits de dados (LSB primeiro) + paridade par,
// 30 ms cada (1100 Hz = 1, 1300 Hz = 0) → stop bit 1200 Hz 30 ms.

import { mediana, mediaMovel } from './dsp.js';

export const DURACAO_BIT = 30;
/** Do início do start bit até o fim do stop bit, em ms. */
export const DURACAO_APOS_START = 10 * DURACAO_BIT;

const FREQ_LIDER = 1900;
const FREQ_START = 1200;
const TOLERANCIA = 150;
const JANELA_LIDER = 250;
const FRACAO_MINIMA = 0.7;
const DESVIO_MAXIMO = 150;
const SUAVIZACAO = 2; // ms

/**
 * Procura o início do start bit entre os índices `de` e `ate` de `freqs`.
 * Exige que antes dele haja ~250 ms de leader e que ele dure ~30 ms.
 * Retorna o índice da transição 1900 → 1200 Hz, ou -1.
 */
export function procurarInicioVis(freqs, taxa, de, ate) {
  const ms = taxa / 1000;
  const L = Math.round(JANELA_LIDER * ms);
  const startDe = Math.round(3 * ms);
  const startAte = Math.round(27 * ms);

  const ini = Math.max(0, de - L);
  const fim = Math.min(freqs.length, ate + startAte + 1);
  de = Math.max(de, ini + L);
  ate = Math.min(ate, fim - startAte - 1);
  if (ate < de) return -1;

  // somas acumuladas de "está perto de 1900" e "está perto de 1200"
  const suaves = mediaMovel(freqs.subarray(ini, fim), 2 * Math.floor((SUAVIZACAO * ms) / 2) + 1);
  const n = fim - ini;
  const lider = new Int32Array(n + 1);
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const f = suaves[i];
    lider[i + 1] = lider[i] + (Math.abs(f - FREQ_LIDER) < TOLERANCIA ? 1 : 0);
    start[i + 1] = start[i] + (Math.abs(f - FREQ_START) < TOLERANCIA ? 1 : 0);
  }

  for (let s = de; s <= ate; s++) {
    const k = s - ini;
    if ((lider[k] - lider[k - L]) / L < FRACAO_MINIMA) continue;
    if ((start[k + startAte] - start[k + startDe]) / (startAte - startDe) < FRACAO_MINIMA) continue;
    return ini + refinarTransicao(suaves, k, ms);
  }
  return -1;
}

// O primeiro candidato aceito costuma vir até ~10 ms antes da transição real;
// procura o ponto onde a frequência suavizada cruza o meio do caminho.
function refinarTransicao(suaves, k, ms) {
  const limite = Math.min(suaves.length, k + Math.round(25 * ms));
  const meio = (FREQ_LIDER + FREQ_START) / 2;
  for (let t = k; t < limite; t++) {
    if (suaves[t] < meio) return t;
  }
  return k;
}

// Nos bits a média erra menos que a mediana: o ruído da frequência
// instantânea é largo e simétrico, e a média de 20 ms o reduz bem.
function media(valores) {
  let soma = 0;
  for (const valor of valores) soma += valor;
  return soma / valores.length;
}

/**
 * Lê os bits do VIS a partir do início do start bit.
 * Precisa de dados até `inicio + DURACAO_APOS_START`.
 * Retorna { codigo, desvio } ou null se a paridade falhar.
 * `desvio` é o erro de sintonia estimado pelo leader (Hz).
 */
export function lerVis(freqs, taxa, inicio) {
  const ms = taxa / 1000;
  const lider = mediana(freqs.subarray(Math.max(0, inicio - Math.round(JANELA_LIDER * ms)), inicio - Math.round(20 * ms)));
  const desvio = lider - FREQ_LIDER;
  if (!(Math.abs(desvio) <= DESVIO_MAXIMO)) return null;

  const bits = [];
  for (let i = 0; i < 8; i++) {
    const de = inicio + Math.round(((i + 1) * DURACAO_BIT + 5) * ms);
    const ate = inicio + Math.round(((i + 2) * DURACAO_BIT - 5) * ms);
    const f = media(freqs.subarray(de, ate)) - desvio;
    bits.push(f < FREQ_START ? 1 : 0);
  }

  const uns = bits.reduce((soma, bit) => soma + bit, 0);
  if (uns % 2 !== 0) return null;

  let codigo = 0;
  for (let i = 0; i < 7; i++) codigo |= bits[i] << i;
  return { codigo, desvio };
}
