// Codificador SSTV: gera o áudio de uma imagem em qualquer modo de `modos.js`.
// Usado nos testes de ida e volta e para gerar arquivos .wav de exemplo.

import { rgbParaYcc } from './cores.js';
import { FREQ_PRETO, FREQ_BRANCO, FREQ_SYNC } from './modos.js';

const DOIS_PI = 2 * Math.PI;

/** Lista de tons [frequência, duração em ms] do cabeçalho VIS. */
export function tonsVis(codigo) {
  const tons = [[1900, 300], [1200, 10], [1900, 300], [1200, 30]];
  let uns = 0;
  for (let i = 0; i < 7; i++) {
    const bit = (codigo >> i) & 1;
    uns += bit;
    tons.push([bit ? 1100 : 1300, 30]);
  }
  tons.push([uns % 2 ? 1100 : 1300, 30]);
  tons.push([1200, 30]);
  return tons;
}

/**
 * Sintetiza uma sequência de tons com fase contínua.
 * O tempo é acumulado em ponto flutuante para não acumular erro de arredondamento.
 */
export function sintetizar(tons, taxa, { silencioInicial = 0.3, silencioFinal = 0.3, desvioFrequencia = 0, amplitude = 0.5 } = {}) {
  const duracaoTons = tons.reduce((soma, [, duracao]) => soma + duracao, 0) / 1000;
  const amostras = new Float32Array(Math.ceil((silencioInicial + duracaoTons + silencioFinal) * taxa));
  let tempo = silencioInicial * taxa;
  let fase = 0;
  for (const [freq, duracao] of tons) {
    const fim = tempo + (duracao * taxa) / 1000;
    const passo = (DOIS_PI * (freq + desvioFrequencia)) / taxa;
    for (let i = Math.ceil(tempo); i < Math.ceil(fim); i++) {
      fase += passo;
      if (fase >= DOIS_PI) fase -= DOIS_PI;
      amostras[i] = amplitude * Math.sin(fase);
    }
    tempo = fim;
  }
  return amostras;
}

/**
 * Codifica uma imagem RGBA ({ largura, altura, dados }) no modo dado.
 * As dimensões da imagem devem ser as do modo.
 */
export function codificar(modo, imagem, taxa, { comVis = true, ...opcoesSintese } = {}) {
  if (imagem.largura !== modo.largura || imagem.altura !== modo.altura) {
    throw new Error(`A imagem deve ter ${modo.largura}×${modo.altura} pixels para o modo ${modo.nome}.`);
  }
  const tons = comVis ? tonsVis(modo.vis) : [];
  if (modo.syncInicial) tons.push([FREQ_SYNC, modo.syncInicial]);

  const unidades = Math.ceil(modo.altura / modo.linhasPorUnidade);
  for (let n = 0; n < unidades; n++) {
    const componentes = componentesDaUnidade(modo, imagem, n);
    for (const segmento of modo.segmentos) {
      if (segmento.tipo !== 'canal') {
        tons.push([segmento.freq, segmento.duracao]);
        continue;
      }
      const duracaoPixel = segmento.duracao / modo.largura;
      for (const valor of componentes[segmento.nome]) {
        tons.push([FREQ_PRETO + (valor * (FREQ_BRANCO - FREQ_PRETO)) / 255, duracaoPixel]);
      }
    }
  }
  return sintetizar(tons, taxa, opcoesSintese);
}

function componentesDaUnidade(modo, imagem, n) {
  const { largura, linhasPorUnidade, familia } = modo;
  const linhas = [];
  for (let l = 0; l < linhasPorUnidade; l++) linhas.push(Math.min(n * linhasPorUnidade + l, modo.altura - 1));
  const pixel = (x, y) => {
    const posicao = (y * largura + x) * 4;
    return [imagem.dados[posicao], imagem.dados[posicao + 1], imagem.dados[posicao + 2]];
  };

  if (familia === 'rgb') {
    const R = new Float32Array(largura), G = new Float32Array(largura), B = new Float32Array(largura);
    for (let x = 0; x < largura; x++) [R[x], G[x], B[x]] = pixel(x, linhas[0]);
    return { R, G, B };
  }

  const componentes = { RY: new Float32Array(largura), BY: new Float32Array(largura) };
  linhas.forEach((y, l) => {
    const luma = new Float32Array(largura);
    for (let x = 0; x < largura; x++) {
      const [Y, cr, cb] = rgbParaYcc(...pixel(x, y));
      luma[x] = Y;
      componentes.RY[x] += cr / linhasPorUnidade;
      componentes.BY[x] += cb / linhasPorUnidade;
    }
    componentes[linhasPorUnidade === 1 ? 'Y' : `Y${l}`] = luma;
  });
  return componentes;
}
