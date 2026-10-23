// Decodificador SSTV em streaming: recebe blocos de áudio (de arquivo ou do
// microfone) e emite eventos conforme as linhas da imagem ficam prontas.
//
// Estados: BUSCA_VIS → LINHAS → (concluir) → BUSCA_VIS ...
// Com modo manual, BUSCA_SYNC substitui BUSCA_VIS: a imagem começa no primeiro
// par de pulsos de sync separados exatamente por um período de linha.

import { Demodulador, mediana, mediaMovel, combinarDetalhe, CORTE_ESTREITO, CORTE_LARGO } from './dsp.js';
import { procurarInicioVis, lerVis, DURACAO_APOS_START } from './vis.js';
import { MODO_POR_VIS, buscarModo, FREQ_SYNC, FREQ_PRETO, FREQ_BRANCO } from './modos.js';
import { ajustarReta } from './inclinacao.js';
import { yccParaRgb } from './cores.js';

const ESTADOS = Object.freeze({ BUSCA_VIS: 'busca-vis', BUSCA_SYNC: 'busca-sync', LINHAS: 'linhas' });

const JANELA_SYNC_MS = 8;
const SUAVIZACAO_SYNC_MS = 1;
const LIMIAR_SYNC = 0.6;
const LIMIAR_SYNC_INICIAL = 0.8;
const FALHAS_MAXIMAS = 20;
const SYNCS_MINIMOS = 5;
const MANTER_HISTORICO_MS = 1000;
const APARAR_ACIMA_DE_MS = 5000;
const FAIXA_PIXEL = FREQ_BRANCO - FREQ_PRETO;
const JANELA_RUIDO_MAXIMA = 32; // amostras: cobre o pixel mais longo (Scottie DX a 22 kHz)

/** Frequências demoduladas com índice absoluto (contado desde o início). */
class HistoricoFrequencias {
  constructor() {
    this.dados = new Float32Array(1 << 16);
    this.tamanho = 0;
    this.base = 0;
  }

  get fim() {
    return this.base + this.tamanho;
  }

  adicionar(valores) {
    const necessario = this.tamanho + valores.length;
    if (necessario > this.dados.length) {
      let capacidade = this.dados.length;
      while (capacidade < necessario) capacidade *= 2;
      const novos = new Float32Array(capacidade);
      novos.set(this.dados.subarray(0, this.tamanho));
      this.dados = novos;
    }
    this.dados.set(valores, this.tamanho);
    this.tamanho = necessario;
  }

  descartarAte(posicao) {
    const quantidade = Math.min(posicao - this.base, this.tamanho);
    if (quantidade <= 0) return;
    this.dados.copyWithin(0, quantidade, this.tamanho);
    this.tamanho -= quantidade;
    this.base += quantidade;
  }

  valor(posicao) {
    const i = posicao - this.base;
    return i >= 0 && i < this.tamanho ? this.dados[i] : NaN;
  }

  visao() {
    return this.dados.subarray(0, this.tamanho);
  }
}

export class Decodificador {
  /**
   * @param {object} opcoes
   * @param {number} opcoes.taxaAmostragem taxa do áudio de entrada (Hz)
   * @param {string|null} [opcoes.modo] id do modo para decodificação manual; null = automático pelo VIS
   * @param {(e: {modo, desvio, origem}) => void} [opcoes.aoDetectarModo]
   * @param {(e: {imagem, largura, altura, linhaInicial, linhaFinal, modo}) => void} [opcoes.aoAtualizar]
   * @param {(e: {imagem, largura, altura, linhas, modo, sincronismos, relogio}) => void} [opcoes.aoConcluir]
   * @param {(e: {modo, motivo}) => void} [opcoes.aoDescartar]
   * @param {(codigo: number) => void} [opcoes.aoVisDesconhecido]
   */
  constructor({ taxaAmostragem, modo = null, ...eventos }) {
    this.demodulador = new Demodulador(taxaAmostragem, { cortes: [CORTE_ESTREITO, CORTE_LARGO] });
    this.amostrasPorMs = this.demodulador.taxaSaida / 1000;
    this.modoManual = modo ? buscarModo(modo) : null;
    if (modo && !this.modoManual) throw new Error(`Modo desconhecido: ${modo}`);
    this.eventos = eventos;
    // estreito: VIS, sync e base dos pixels; largo: só o detalhe dos pixels
    this.historico = new HistoricoFrequencias();
    this.historicoLargo = new HistoricoFrequencias();
    this.estado = this.modoManual ? ESTADOS.BUSCA_SYNC : ESTADOS.BUSCA_VIS;
    this.proximoCandidato = 0;
    this.candidatoVis = null;
  }

  /** Recebe um bloco de amostras de áudio (Float32Array, mono). */
  processar(amostras) {
    const [estreito, largo] = this.demodulador.processar(amostras);
    this.historico.adicionar(estreito);
    this.historicoLargo.adicionar(largo);
    this.avancar();
  }

  /** Fim do áudio: entrega a imagem em andamento, mesmo incompleta. */
  finalizar() {
    if (this.estado !== ESTADOS.LINHAS) return;
    while (this.unidade < this.totalUnidades && this.inicioUnidade(this.unidade, this.reta) < this.historico.fim) {
      this.decodificarUnidade(this.unidade, this.reta);
      this.unidade++;
    }
    this.concluir();
  }

  avancar() {
    let progrediu = true;
    while (progrediu) {
      if (this.estado === ESTADOS.BUSCA_VIS) progrediu = this.passoBuscaVis();
      else if (this.estado === ESTADOS.BUSCA_SYNC) progrediu = this.passoBuscaSync();
      else progrediu = this.passoLinhas();
    }
  }

  amostras(ms) {
    return ms * this.amostrasPorMs;
  }

  // ---------------------------------------------------------------- busca

  passoBuscaVis() {
    const h = this.historico;
    const visao = h.visao();
    const taxa = this.demodulador.taxaSaida;

    if (this.candidatoVis === null) {
      const de = Math.max(this.proximoCandidato, h.base + Math.round(this.amostras(250)));
      const ate = h.fim - Math.round(this.amostras(30));
      if (ate <= de) {
        this.aparar();
        return false;
      }
      const inicio = procurarInicioVis(visao, taxa, de - h.base, ate - h.base);
      if (inicio < 0) {
        this.proximoCandidato = ate + 1;
        this.aparar();
        return false;
      }
      this.candidatoVis = inicio + h.base;
    }

    if (h.fim < this.candidatoVis + Math.ceil(this.amostras(DURACAO_APOS_START)) + 1) return false;

    const leitura = lerVis(visao, taxa, this.candidatoVis - h.base);
    const modo = leitura && MODO_POR_VIS.get(leitura.codigo);
    if (!modo) {
      if (leitura) this.eventos.aoVisDesconhecido?.(leitura.codigo);
      this.proximoCandidato = this.candidatoVis + Math.round(this.amostras(30));
      this.candidatoVis = null;
      return true;
    }

    const inicioDados = this.candidatoVis + this.amostras(DURACAO_APOS_START);
    this.candidatoVis = null;
    this.iniciarImagem(modo, inicioDados + this.amostras(modo.syncInicial + modo.deslocSync), leitura.desvio, 'vis');
    return true;
  }

  passoBuscaSync() {
    const modo = this.modoManual;
    const h = this.historico;
    const duracao = Math.round(this.amostras(modo.duracaoSync));
    const periodo = this.amostras(modo.periodo);
    const janela = Math.round(this.amostras(JANELA_SYNC_MS));
    const de = Math.max(this.proximoCandidato, h.base);
    const ate = Math.floor(h.fim - periodo - janela - duracao - this.amostras(3) - 1);
    if (ate < de) {
      this.aparar();
      return false;
    }

    const pontuacoes = Decodificador.pontuar(this.pesosSync(de, ate + duracao, 0), duracao);
    for (let p = de; p <= ate; p++) {
      if (pontuacoes[p - de] / duracao < LIMIAR_SYNC_INICIAL) continue;
      const seguinte = this.procurarSync(p + periodo, janela, modo.duracaoSync, 0);
      if (seguinte === null) continue;

      const inicioSync = Math.round(seguinte) - h.base;
      const freqSync = mediana(h.visao().subarray(inicioSync, inicioSync + duracao));
      this.iniciarImagem(modo, seguinte - periodo, freqSync - FREQ_SYNC, 'sync');
      return true;
    }
    this.proximoCandidato = ate + 1;
    this.aparar();
    return false;
  }

  aparar() {
    const h = this.historico;
    const limite = Math.min(this.proximoCandidato, h.fim) - Math.round(this.amostras(MANTER_HISTORICO_MS));
    if (limite - h.base > this.amostras(APARAR_ACIMA_DE_MS)) this.descartarHistoricoAte(limite);
  }

  descartarHistoricoAte(posicao) {
    this.historico.descartarAte(posicao);
    this.historicoLargo.descartarAte(posicao);
  }

  // --------------------------------------------------------------- imagem

  iniciarImagem(modo, primeiroSync, desvio, origem) {
    this.modo = modo;
    this.desvio = desvio;
    this.periodoNominal = this.amostras(modo.periodo);
    this.reta = { a: primeiroSync, b: this.periodoNominal };
    this.pontos = [];
    this.ruidoDetalhe = {
      somas: new Float64Array(JANELA_RUIDO_MAXIMA + 1),
      contagens: new Float64Array(JANELA_RUIDO_MAXIMA + 1),
    };
    this.unidade = 0;
    this.falhas = 0;
    this.totalUnidades = Math.ceil(modo.altura / modo.linhasPorUnidade);
    this.imagem = new Uint8ClampedArray(modo.largura * modo.altura * 4);
    for (let i = 3; i < this.imagem.length; i += 4) this.imagem[i] = 255;
    this.estado = ESTADOS.LINHAS;

    const descartar = Math.round(primeiroSync - this.amostras(modo.syncInicial + modo.deslocSync + MANTER_HISTORICO_MS));
    if (descartar > this.historico.base) this.descartarHistoricoAte(descartar);
    this.eventos.aoDetectarModo?.({ modo, desvio, origem });
  }

  passoLinhas() {
    const modo = this.modo;
    if (this.unidade >= this.totalUnidades || this.falhas >= FALHAS_MAXIMAS) {
      this.concluir();
      return true;
    }

    const n = this.unidade;
    const janela = Math.round(this.amostras(JANELA_SYNC_MS));
    const duracao = Math.round(this.amostras(modo.duracaoSync));
    const previsto = this.reta.a + this.reta.b * n;
    const margemBorda = this.amostras(3);
    const necessario = Math.max(previsto + janela + duracao + margemBorda, this.inicioUnidade(n, this.reta) + this.reta.b) + 1;
    if (this.historico.fim < necessario) return false;

    const encontrado = this.procurarSync(previsto, janela, modo.duracaoSync, this.desvio);
    if (encontrado !== null) {
      this.pontos.push({ n, p: encontrado });
      this.medirRuidoDetalhe(encontrado);
      this.falhas = 0;
    } else {
      this.falhas++;
    }
    this.reta = ajustarReta(this.pontos, this.periodoNominal, Math.max(2, this.amostras(1))) ?? this.reta;

    this.decodificarUnidade(n, this.reta);
    this.unidade++;
    const linhaInicial = n * modo.linhasPorUnidade;
    this.eventos.aoAtualizar?.({
      imagem: this.imagem,
      largura: modo.largura,
      altura: modo.altura,
      linhaInicial,
      linhaFinal: Math.min(modo.altura, linhaInicial + modo.linhasPorUnidade),
      modo,
    });
    return true;
  }

  concluir() {
    const modo = this.modo;
    const unidades = this.unidade;
    // Redesenha tudo com a reta final: aqui a inclinação é corrigida de vez.
    for (let n = 0; n < unidades; n++) this.decodificarUnidade(n, this.reta);

    const resultado = {
      imagem: this.imagem,
      largura: modo.largura,
      altura: modo.altura,
      linhas: Math.min(modo.altura, unidades * modo.linhasPorUnidade),
      modo,
      sincronismos: this.pontos.length,
      relogio: this.reta.b / this.periodoNominal,
    };

    this.proximoCandidato = Math.round(this.inicioUnidade(unidades, this.reta));
    this.estado = this.modoManual ? ESTADOS.BUSCA_SYNC : ESTADOS.BUSCA_VIS;
    this.modo = null;
    this.imagem = null;

    if (resultado.sincronismos < Math.min(SYNCS_MINIMOS, unidades)) {
      this.eventos.aoDescartar?.({ modo, motivo: 'Poucos pulsos de sincronismo: provavelmente não era um sinal SSTV.' });
    } else {
      this.eventos.aoConcluir?.(resultado);
    }
    this.aparar();
  }

  inicioUnidade(n, reta) {
    const escala = reta.b / this.periodoNominal;
    return reta.a + reta.b * n - this.amostras(this.modo.deslocSync) * escala;
  }

  decodificarUnidade(n, reta) {
    const modo = this.modo;
    const largura = modo.largura;
    const escala = reta.b / this.periodoNominal;
    const inicio = this.inicioUnidade(n, reta);
    const componentes = {};
    for (const segmento of modo.segmentos) {
      if (segmento.tipo !== 'canal') continue;
      const t0 = inicio + this.amostras(segmento.inicio) * escala;
      const passo = (this.amostras(segmento.duracao) * escala) / largura;
      const base = new Float32Array(largura);
      const detalhe = new Float32Array(largura);
      for (let x = 0; x < largura; x++) {
        const t1 = t0 + x * passo;
        base[x] = mediaFrequencia(this.historico, t1, t1 + passo);
        detalhe[x] = mediaFrequencia(this.historicoLargo, t1, t1 + passo) - base[x];
        if (Number.isNaN(detalhe[x])) detalhe[x] = 0;
      }
      const frequencias = combinarDetalhe(base, detalhe, this.varianciaRuidoDetalhe(passo));
      componentes[segmento.nome] = frequencias.map((f) => this.freqParaValor(f));
    }
    this.escreverLinhas(n, componentes);
  }

  /**
   * Mede, no interior de um pulso de sync (tom constante: tudo que varia é
   * ruído), a variância de (largo − estreito) promediada em janelas de 1 a
   * JANELA_RUIDO_MAXIMA amostras, ou seja, o ruído do detalhe por tamanho de pixel.
   */
  medirRuidoDetalhe(inicioSync) {
    const { somas, contagens } = this.ruidoDetalhe;
    const de = Math.ceil(inicioSync + this.amostras(1));
    const ate = Math.floor(inicioSync + this.amostras(this.modo.duracaoSync - 1));
    for (let tamanho = 1; tamanho <= JANELA_RUIDO_MAXIMA; tamanho++) {
      for (let i = de; i + tamanho <= ate; i += tamanho) {
        let soma = 0;
        for (let j = i; j < i + tamanho; j++) soma += this.historicoLargo.valor(j) - this.historico.valor(j);
        if (Number.isNaN(soma)) continue;
        somas[tamanho] += (soma / tamanho) ** 2;
        contagens[tamanho]++;
      }
    }
  }

  /** Variância do ruído do detalhe para um pixel de `passo` amostras. */
  varianciaRuidoDetalhe(passo) {
    const { somas, contagens } = this.ruidoDetalhe;
    const tamanho = Math.min(JANELA_RUIDO_MAXIMA, Math.max(1, Math.round(passo)));
    // sync curto demais para a janela: extrapola do maior tamanho medido (∝ 1/n)
    for (let medido = tamanho; medido >= 1; medido--) {
      if (contagens[medido] > 0) return ((somas[medido] / contagens[medido]) * medido) / tamanho;
    }
    return 0;
  }

  escreverLinhas(n, componentes) {
    const { largura, altura, linhasPorUnidade, familia } = this.modo;
    for (let l = 0; l < linhasPorUnidade; l++) {
      const y = n * linhasPorUnidade + l;
      if (y >= altura) break;
      let posicao = y * largura * 4;
      const luma = componentes[`Y${l}`] ?? componentes.Y;
      for (let x = 0; x < largura; x++) {
        const [r, g, b] = familia === 'rgb'
          ? [componentes.R[x], componentes.G[x], componentes.B[x]]
          : yccParaRgb(luma[x], componentes.RY[x], componentes.BY[x]);
        this.imagem[posicao++] = r;
        this.imagem[posicao++] = g;
        this.imagem[posicao++] = b;
        posicao++;
      }
    }
  }

  freqParaValor(f) {
    if (Number.isNaN(f)) return 0;
    const valor = ((f - this.desvio - FREQ_PRETO) * 255) / FAIXA_PIXEL;
    return valor < 0 ? 0 : valor > 255 ? 255 : valor;
  }

  /**
   * "Quanto cada amostra de [de, ate) parece sync": 1 em 1200 Hz, 0 a partir
   * de 1450 Hz (a faixa de imagem nunca vai abaixo de 1500). Calculado sobre a
   * frequência suavizada, senão o ruído derruba a detecção com sinal fraco.
   */
  pesosSync(de, ate, desvio) {
    const suaves = this.frequenciasSuaves(de, ate);
    const pesos = new Float32Array(suaves.length);
    for (let i = 0; i < pesos.length; i++) {
      const f = suaves[i] - desvio;
      pesos[i] = f >= 1450 ? 0 : f <= 1300 ? 1 : (1450 - f) / 150;
    }
    return pesos;
  }

  /** Frequências de [de, ate) com média móvel centrada de ~1 ms. */
  frequenciasSuaves(de, ate) {
    const largura = impar(this.amostras(SUAVIZACAO_SYNC_MS));
    const margem = largura >> 1;
    const brutos = new Float32Array(ate - de + 2 * margem);
    for (let i = 0; i < brutos.length; i++) {
      const f = this.historico.valor(de - margem + i);
      brutos[i] = Number.isNaN(f) ? FREQ_PRETO : f;
    }
    return mediaMovel(brutos, largura).subarray(margem, margem + ate - de);
  }

  /**
   * Posição exata (fracionária) do início do sync, medida pela borda final.
   * A borda inicial vem do último pixel da linha anterior, cujo valor varia, e
   * o transiente do demodulador desloca o cruzamento conforme o salto. A final
   * é sempre 1200 → 1500 Hz (sync → porch) em todos os modos: referência estável.
   */
  refinarPelaBordaFinal(inicio, duracaoExata, desvio) {
    const margem = Math.round(this.amostras(2));
    const de = Math.round(inicio + duracaoExata) - margem;
    const suaves = this.frequenciasSuaves(de, de + 2 * margem);
    const limiar = (FREQ_SYNC + FREQ_PRETO) / 2 + desvio;
    for (let i = 1; i < suaves.length; i++) {
      if (suaves[i - 1] < limiar && suaves[i] >= limiar) {
        const fracao = (limiar - suaves[i - 1]) / (suaves[i] - suaves[i - 1]);
        return de + i - 1 + fracao - duracaoExata;
      }
    }
    return inicio;
  }

  /** Soma de `pesos` em cada janela de `duracao` amostras (pontuação do sync). */
  static pontuar(pesos, duracao) {
    const pontuacoes = new Float32Array(Math.max(0, pesos.length - duracao + 1));
    let soma = 0;
    for (let i = 0; i < duracao; i++) soma += pesos[i];
    for (let p = 0; p < pontuacoes.length; p++) {
      if (p > 0) soma += pesos[p + duracao - 1] - pesos[p - 1];
      pontuacoes[p] = soma;
    }
    return pontuacoes;
  }

  /**
   * Procura o pulso de sync mais forte em previsto ± janela e devolve a
   * posição do seu início (fracionária), ou null.
   * Em empate (pulso emendado em outro trecho de 1200 Hz, como o stop bit do
   * VIS) fica a posição mais próxima da prevista.
   */
  procurarSync(previsto, janela, duracaoMs, desvio) {
    const duracaoExata = this.amostras(duracaoMs);
    const duracao = Math.round(duracaoExata);
    const de = Math.round(previsto - janela);
    const ate = Math.round(previsto + janela);
    const pontuacoes = Decodificador.pontuar(this.pesosSync(de, ate + duracao, desvio), duracao);
    const maxima = pontuacoes.reduce((a, b) => (b > a ? b : a), 0);
    if (maxima / duracao < LIMIAR_SYNC) return null;

    let melhor = null;
    for (let p = de; p <= ate; p++) {
      // tolerância mínima: só platôs exatos; uma folga maior enviesaria cada
      // linha para a previsão e o erro inicial nunca seria corrigido
      if (pontuacoes[p - de] < maxima - 0.5) continue;
      if (melhor === null || Math.abs(p - previsto) < Math.abs(melhor - previsto)) melhor = p;
    }
    return this.refinarPelaBordaFinal(melhor, duracaoExata, desvio);
  }
}

/** Média das frequências entre t1 e t2 (amostras); NaN se não houver dados. */
function mediaFrequencia(historico, t1, t2) {
  let soma = 0;
  let contagem = 0;
  for (let i = Math.ceil(t1), fim = Math.ceil(t2); i < fim; i++) {
    const f = historico.valor(i);
    if (!Number.isNaN(f)) {
      soma += f;
      contagem++;
    }
  }
  return contagem > 0 ? soma / contagem : historico.valor(Math.round((t1 + t2) / 2));
}

/** Arredonda para o ímpar mais próximo (média móvel centrada sem meio passo). */
function impar(valor) {
  return 2 * Math.floor(valor / 2) + 1;
}
