// Correção de inclinação (slant).
//
// A posição de cada pulso de sync encontrado vira um ponto (n, p): n é o número
// da unidade de varredura e p a posição em amostras. Ajustando p = a + b·n,
// `b` revela o período real da linha, que difere do nominal quando o relógio
// da placa de som do transmissor ou do receptor não é exato.

import { mediana } from './dsp.js';

// Já com 3 pontos a inclinação é estimada: com a nominal, um relógio 0,5% fora
// faz a previsão escorregar ~2 ms por linha e sair da janela de busca do sync.
const MINIMO_PARA_INCLINACAO = 3;
const MINIMO_PARA_REFINO = 10;
const DESVIO_MAXIMO_RELOGIO = 0.015;
const MAXIMO_PONTOS_THEIL_SEN = 64;

/**
 * Ajusta uma reta robusta aos pontos de sync.
 * Retorna { a, b } ou null se não houver pontos.
 */
export function ajustarReta(pontos, inclinacaoNominal, tolerancia) {
  if (pontos.length === 0) return null;

  const plausivel = (b) => Math.abs(b / inclinacaoNominal - 1) <= DESVIO_MAXIMO_RELOGIO;

  let b = inclinacaoNominal;
  if (pontos.length >= MINIMO_PARA_INCLINACAO) {
    const estimada = inclinacaoTheilSen(pontos);
    if (plausivel(estimada)) b = estimada;
  }
  let a = mediana(pontos.map((ponto) => ponto.p - b * ponto.n));

  // Refinamento por mínimos quadrados, só com os pontos próximos da reta.
  if (b !== inclinacaoNominal) {
    const proximos = pontos.filter((ponto) => Math.abs(ponto.p - (a + b * ponto.n)) <= tolerancia);
    if (proximos.length >= MINIMO_PARA_REFINO) {
      const reta = minimosQuadrados(proximos);
      if (reta && plausivel(reta.b)) ({ a, b } = reta);
    }
  }
  return { a, b };
}

// Mediana das inclinações entre pares de pontos: ignora syncs falsos.
function inclinacaoTheilSen(pontos) {
  const passo = Math.max(1, Math.floor(pontos.length / MAXIMO_PONTOS_THEIL_SEN));
  const amostra = pontos.filter((_, i) => i % passo === 0);
  const inclinacoes = [];
  for (let i = 0; i < amostra.length; i++) {
    for (let j = i + 1; j < amostra.length; j++) {
      const dn = amostra[j].n - amostra[i].n;
      if (dn >= 1) inclinacoes.push((amostra[j].p - amostra[i].p) / dn);
    }
  }
  return mediana(inclinacoes);
}

function minimosQuadrados(pontos) {
  const total = pontos.length;
  let somaN = 0, somaP = 0, somaNN = 0, somaNP = 0;
  for (const { n, p } of pontos) {
    somaN += n;
    somaP += p;
    somaNN += n * n;
    somaNP += n * p;
  }
  const denominador = total * somaNN - somaN * somaN;
  if (denominador === 0) return null;
  const b = (total * somaNP - somaN * somaP) / denominador;
  return { a: (somaP - b * somaN) / total, b };
}
