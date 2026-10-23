import { Decodificador } from '../src/decodificador.js';
import { rgbParaYcc } from '../src/cores.js';
import { CORES_BARRAS, LARGURAS_LISTRAS } from '../ferramentas/sinal-teste.js';

/** Decodifica um áudio inteiro em blocos, como faria a interface. */
export function decodificarTudo(amostras, taxa, { modo = null, bloco = 4096 } = {}) {
  const imagens = [];
  const modos = [];
  const descartes = [];
  const decodificador = new Decodificador({
    taxaAmostragem: taxa,
    modo,
    aoDetectarModo: (evento) => modos.push(evento),
    aoConcluir: (resultado) => imagens.push(resultado),
    aoDescartar: (evento) => descartes.push(evento),
  });
  for (let i = 0; i < amostras.length; i += bloco) decodificador.processar(amostras.subarray(i, i + bloco));
  decodificador.finalizar();
  return { imagens, modos, descartes };
}

/**
 * PSNR (dB) entre duas imagens RGBA, ignorando o alfa.
 * `margem` descarta colunas nas bordas, onde o filtro borra a transição para
 * o tom vizinho (efeito inerente à banda do sinal).
 */
export function psnr(original, decodificada, largura, { margem = 0, linhas = Infinity } = {}) {
  const altura = Math.min(original.length / 4 / largura, linhas);
  let somaQuadrados = 0;
  let contagem = 0;
  for (let y = 0; y < altura; y++) {
    for (let x = margem; x < largura - margem; x++) {
      for (let c = 0; c < 3; c++) {
        const posicao = (y * largura + x) * 4 + c;
        const diferenca = original[posicao] - decodificada[posicao];
        somaQuadrados += diferenca * diferenca;
        contagem++;
      }
    }
  }
  return 10 * Math.log10((255 * 255) / (somaQuadrados / contagem));
}

/**
 * Mede uma imagem decodificada a partir de `padraoDeNitidez`:
 * - saturacao: croma médio das barras de cor, relativo ao original (1 = igual);
 * - contrastes: para cada largura de listra, (média nos brancos − média nos
 *   pretos) do luma, relativo à faixa cheia (1 = listras perfeitas).
 * Ignora uma margem nas bordas de cada barra/faixa.
 */
export function medirNitidez(original, decodificada, largura, altura) {
  const terco = Math.floor(altura / 3);
  const ycc = (dados, x, y) => {
    const posicao = (y * largura + x) * 4;
    return rgbParaYcc(dados[posicao], dados[posicao + 1], dados[posicao + 2]);
  };

  const larguraBarra = largura / CORES_BARRAS.length;
  let cromaOriginal = 0;
  let cromaDecodificado = 0;
  for (let y = 4; y < terco - 4; y++) {
    for (let barra = 0; barra < CORES_BARRAS.length; barra++) {
      for (let x = Math.round(barra * larguraBarra + 6); x < Math.round((barra + 1) * larguraBarra - 6); x++) {
        const [, crO, cbO] = ycc(original, x, y);
        const [, crD, cbD] = ycc(decodificada, x, y);
        cromaOriginal += Math.hypot(crO - 128, cbO - 128);
        cromaDecodificado += Math.hypot(crD - 128, cbD - 128);
      }
    }
  }

  const larguraFaixa = largura / LARGURAS_LISTRAS.length;
  const contrastes = LARGURAS_LISTRAS.map((_, faixa) => {
    let brancos = 0, nBrancos = 0, pretos = 0, nPretos = 0;
    for (let y = terco + 4; y < 2 * terco - 4; y++) {
      for (let x = Math.round(faixa * larguraFaixa + 8); x < Math.round((faixa + 1) * larguraFaixa - 8); x++) {
        const luma = ycc(decodificada, x, y)[0];
        if (ycc(original, x, y)[0] > 128) { brancos += luma; nBrancos++; } else { pretos += luma; nPretos++; }
      }
    }
    return (brancos / nBrancos - pretos / nPretos) / 219;
  });

  return { saturacao: cromaDecodificado / cromaOriginal, contrastes };
}

/** Ruído gaussiano determinístico (mesma semente, mesmo ruído). */
export function adicionarRuido(amostras, desvioPadrao, semente = 1) {
  let estado = semente >>> 0;
  const aleatorio = () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const saida = new Float32Array(amostras.length);
  for (let i = 0; i < amostras.length; i++) {
    const u = 1 - aleatorio();
    const v = aleatorio();
    saida[i] = amostras[i] + desvioPadrao * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return saida;
}
