// Processamento de sinal: demodulação FM em quadratura e utilitários.
// Não depende do DOM: roda no navegador e no Node.

export const FREQ_CENTRAL = 1900;
const DOIS_PI = 2 * Math.PI;
// Dois passa-baixas: o estreito (900–2900 Hz) tem pouco ruído e alimenta VIS,
// sync e a base dos pixels; o largo (até ±2 kHz, perto da banda de Carson do
// Robot 36) preserva detalhe fino. Só com o estreito, linhas de 1 px somem.
export const CORTE_ESTREITO = 1000;
export const CORTE_LARGO = 2000;
// Calibrados com padraoDeNitidez e padraoDeTeste sob ruído (ver testes).
const RAIO_WIENER = 3;
const LIMIAR_WIENER = 2;
const DURACAO_FILTRO = 0.004; // segundos de resposta ao impulso do FIR
const TAXA_SAIDA_MINIMA = 15000;

export function projetarPassaBaixa(numCoeficientes, corte, taxa) {
  const coeficientes = new Float32Array(numCoeficientes);
  const meio = (numCoeficientes - 1) / 2;
  const fc = corte / taxa;
  let soma = 0;
  for (let i = 0; i < numCoeficientes; i++) {
    const t = i - meio;
    const sinc = t === 0 ? 2 * fc : Math.sin(DOIS_PI * fc * t) / (Math.PI * t);
    const hamming = 0.54 - 0.46 * Math.cos((DOIS_PI * i) / (numCoeficientes - 1));
    coeficientes[i] = sinc * hamming;
    soma += coeficientes[i];
  }
  for (let i = 0; i < numCoeficientes; i++) coeficientes[i] /= soma;
  return coeficientes;
}

export function mediana(valores) {
  if (valores.length === 0) return NaN;
  const ordenados = Float64Array.from(valores).sort();
  const meio = ordenados.length >> 1;
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

/**
 * Média móvel centrada de `largura` amostras (nas bordas, janela parcial).
 * A frequência instantânea tem ruído forte amostra a amostra: suavizar ~2 ms
 * antes de procurar VIS e sync é o que garante a detecção com sinal fraco.
 */
export function mediaMovel(valores, largura) {
  const saida = new Float32Array(valores.length);
  const antes = largura >> 1;
  const depois = largura - antes;
  let soma = 0;
  let inicio = 0;
  let fim = 0;
  for (let i = 0; i < valores.length; i++) {
    const novoInicio = Math.max(0, i - antes);
    const novoFim = Math.min(valores.length, i + depois);
    while (fim < novoFim) soma += valores[fim++];
    while (inicio < novoInicio) soma -= valores[inicio++];
    saida[i] = soma / (fim - inicio);
  }
  return saida;
}

/**
 * Laço quente do demodulador: filtra I/Q nas posições de saída (de `de` a
 * `ate`, de `passo` em `passo`) e grava a frequência instantânea em `saida`.
 * Fica fora da classe de propósito: dentro do fechamento do `processar` o V8
 * gerava código ~2× mais lento.
 */
function filtrarEMedirFrequencia(I, Q, filtro, de, ate, passo, taxaSaida, saida) {
  const coeficientes = filtro.coeficientes;
  const numCoeficientes = coeficientes.length;
  const escala = taxaSaida / DOIS_PI;
  let anteriorRe = filtro.anteriorRe;
  let anteriorIm = filtro.anteriorIm;
  let k = 0;
  for (let p = de; p < ate; p += passo) {
    const inicio = p - numCoeficientes + 1;
    let re = 0;
    let im = 0;
    for (let j = 0; j < numCoeficientes; j++) {
      const c = coeficientes[j];
      re += c * I[inicio + j];
      im += c * Q[inicio + j];
    }
    // z[n] · conj(z[n-1]): o ângulo é o avanço de fase entre as amostras
    const difRe = re * anteriorRe + im * anteriorIm;
    const difIm = im * anteriorRe - re * anteriorIm;
    saida[k++] = FREQ_CENTRAL + Math.atan2(difIm, difRe) * escala;
    anteriorRe = re;
    anteriorIm = im;
  }
  filtro.anteriorRe = anteriorRe;
  filtro.anteriorIm = anteriorIm;
}

/**
 * Junta a versão estreita (pouco ruído) com o detalhe da versão larga
 * (nitidez), atenuando o detalhe onde ele não se destaca do ruído.
 *
 * `base` e `detalhe` são frequências por pixel de uma linha; `ruido2` é a
 * variância do detalhe quando só há ruído. Filtro de Wiener local: o ganho de
 * cada pixel é potência do sinal / (sinal + ruído), com a potência estimada
 * numa janela de 2·RAIO_WIENER + 1 pixels. Com sinal limpo (ruído ≈ 0) o
 * resultado é a própria versão larga.
 */
export function combinarDetalhe(base, detalhe, ruido2) {
  const largura = base.length;
  const saida = new Float32Array(largura);
  for (let x = 0; x < largura; x++) {
    let potencia = 0;
    for (let j = -RAIO_WIENER; j <= RAIO_WIENER; j++) {
      const d = detalhe[Math.min(largura - 1, Math.max(0, x + j))];
      potencia += d * d;
    }
    potencia /= 2 * RAIO_WIENER + 1;
    const sinal = Math.max(0, potencia - LIMIAR_WIENER * ruido2);
    const ganho = sinal > 0 ? sinal / (sinal + ruido2) : 0;
    saida[x] = base[x] + ganho * detalhe[x];
  }
  return saida;
}

/**
 * Converte áudio em frequência instantânea, em blocos (streaming).
 *
 * O sinal é deslocado para banda base em torno de 1900 Hz, filtrado por
 * passa-baixas FIR (que também servem de anti-aliasing para a decimação) e a
 * frequência sai da diferença de fase entre amostras complexas consecutivas.
 * Cada corte em `cortes` gera uma saída; todos têm o mesmo número de
 * coeficientes, então as saídas ficam alinhadas amostra a amostra.
 */
export class Demodulador {
  constructor(taxaEntrada, { cortes = [CORTE_ESTREITO], duracaoFiltro = DURACAO_FILTRO } = {}) {
    this.taxaEntrada = taxaEntrada;
    this.fator = Math.max(1, Math.floor(taxaEntrada / TAXA_SAIDA_MINIMA));
    this.taxaSaida = taxaEntrada / this.fator;

    let numCoeficientes = Math.round(taxaEntrada * duracaoFiltro);
    if (numCoeficientes % 2 === 0) numCoeficientes++;
    this.filtros = cortes.map((corte) => ({
      coeficientes: projetarPassaBaixa(numCoeficientes, corte, taxaEntrada),
      // Amostra complexa anterior (qualquer valor serve para a primeira).
      // Precisa nascer com valor não inteiro: se nascer como inteiro, o V8
      // desotimiza o laço quando recebe o primeiro double (2× mais lento).
      anteriorRe: 1.5,
      anteriorIm: 0.5,
    }));
    this.numCoeficientes = numCoeficientes;

    this.passoFase = (DOIS_PI * FREQ_CENTRAL) / taxaEntrada;
    this.fase = 0;
    this.restoI = new Float32Array(numCoeficientes - 1);
    this.restoQ = new Float32Array(numCoeficientes - 1);
    this.proximaSaida = numCoeficientes - 1;
  }

  /**
   * Recebe amostras de áudio e devolve, para cada corte, as frequências (Hz)
   * na taxa de saída.
   */
  processar(entrada) {
    const numCoeficientes = this.numCoeficientes;
    const manter = numCoeficientes - 1;
    const total = manter + entrada.length;

    const I = new Float32Array(total);
    const Q = new Float32Array(total);
    I.set(this.restoI);
    Q.set(this.restoQ);
    let fase = this.fase;
    for (let i = 0; i < entrada.length; i++) {
      const amostra = entrada[i];
      I[manter + i] = amostra * Math.cos(fase);
      Q[manter + i] = -amostra * Math.sin(fase);
      fase += this.passoFase;
      if (fase >= DOIS_PI) fase -= DOIS_PI;
    }
    this.fase = fase;

    const quantidade = Math.max(0, Math.ceil((total - this.proximaSaida) / this.fator));
    const saidas = this.filtros.map((filtro) => {
      const saida = new Float32Array(quantidade);
      filtrarEMedirFrequencia(I, Q, filtro, this.proximaSaida, total, this.fator, this.taxaSaida, saida);
      return saida;
    });

    this.proximaSaida += quantidade * this.fator - entrada.length;
    this.restoI = I.slice(total - manter);
    this.restoQ = Q.slice(total - manter);
    return saidas;
  }
}
