// Tabelas de tempo dos modos SSTV. Tempos em milissegundos, frequências em Hz.
//
// Cada modo descreve uma "unidade de varredura": o trecho de sinal que se repete
// e gera `linhasPorUnidade` linhas da imagem (2 no Robot 36 e nos modos PD).

export const FREQ_SYNC = 1200;
export const FREQ_PRETO = 1500;
export const FREQ_BRANCO = 2300;
const FREQ_PORCH_ROBOT = 1900;

const tom = (duracao, freq) => ({ tipo: 'tom', duracao, freq });
const sync = (duracao) => ({ tipo: 'sync', duracao, freq: FREQ_SYNC });
const canal = (duracao, nome) => ({ tipo: 'canal', duracao, nome });

function martin(id, nome, vis, varredura) {
  return {
    id, nome, vis, largura: 320, altura: 256, familia: 'rgb', linhasPorUnidade: 1, syncInicial: 0,
    segmentos: [
      sync(4.862), tom(0.572, FREQ_PRETO),
      canal(varredura, 'G'), tom(0.572, FREQ_PRETO),
      canal(varredura, 'B'), tom(0.572, FREQ_PRETO),
      canal(varredura, 'R'), tom(0.572, FREQ_PRETO),
    ],
  };
}

// No Scottie o sync fica no meio da linha (antes do vermelho) e há um sync
// inicial único logo após o VIS.
function scottie(id, nome, vis, varredura) {
  return {
    id, nome, vis, largura: 320, altura: 256, familia: 'rgb', linhasPorUnidade: 1, syncInicial: 9,
    segmentos: [
      tom(1.5, FREQ_PRETO), canal(varredura, 'G'),
      tom(1.5, FREQ_PRETO), canal(varredura, 'B'),
      sync(9), tom(1.5, FREQ_PRETO), canal(varredura, 'R'),
    ],
  };
}

function pd(id, nome, vis, largura, altura, componente) {
  return {
    id, nome, vis, largura, altura, familia: 'ycc', linhasPorUnidade: 2, syncInicial: 0,
    segmentos: [
      sync(20), tom(2.08, FREQ_PRETO),
      canal(componente, 'Y0'), canal(componente, 'RY'), canal(componente, 'BY'), canal(componente, 'Y1'),
    ],
  };
}

// Robot 36 alterna a crominância: linha par leva R-Y, linha ímpar leva B-Y.
// Tratamos o par de linhas como uma unidade só.
const robot36 = {
  id: 'robot-36', nome: 'Robot 36', vis: 8, largura: 320, altura: 240, familia: 'ycc', linhasPorUnidade: 2, syncInicial: 0,
  segmentos: [
    sync(9), tom(3, FREQ_PRETO), canal(88, 'Y0'),
    tom(4.5, FREQ_PRETO), tom(1.5, FREQ_PORCH_ROBOT), canal(44, 'RY'),
    sync(9), tom(3, FREQ_PRETO), canal(88, 'Y1'),
    tom(4.5, FREQ_BRANCO), tom(1.5, FREQ_PORCH_ROBOT), canal(44, 'BY'),
  ],
};

const robot72 = {
  id: 'robot-72', nome: 'Robot 72', vis: 12, largura: 320, altura: 240, familia: 'ycc', linhasPorUnidade: 1, syncInicial: 0,
  segmentos: [
    sync(9), tom(3, FREQ_PRETO), canal(138, 'Y'),
    tom(4.5, FREQ_PRETO), tom(1.5, FREQ_PORCH_ROBOT), canal(69, 'RY'),
    tom(4.5, FREQ_BRANCO), tom(1.5, FREQ_PORCH_ROBOT), canal(69, 'BY'),
  ],
};

// Calcula os campos derivados: início de cada segmento, período da unidade
// e posição/duração do primeiro sync.
function completar(modo) {
  let inicio = 0;
  const segmentos = modo.segmentos.map((segmento) => {
    const completo = { ...segmento, inicio };
    inicio += segmento.duracao;
    return completo;
  });
  const primeiroSync = segmentos.find((segmento) => segmento.tipo === 'sync');
  return Object.freeze({
    ...modo,
    segmentos,
    periodo: inicio,
    deslocSync: primeiroSync.inicio,
    duracaoSync: primeiroSync.duracao,
  });
}

export const MODOS = [
  martin('martin-m1', 'Martin M1', 44, 146.432),
  martin('martin-m2', 'Martin M2', 40, 73.216),
  scottie('scottie-s1', 'Scottie S1', 60, 138.24),
  scottie('scottie-s2', 'Scottie S2', 56, 88.064),
  scottie('scottie-dx', 'Scottie DX', 76, 345.6),
  robot36,
  robot72,
  pd('pd-90', 'PD90', 99, 320, 256, 170.24),
  pd('pd-120', 'PD120', 95, 640, 496, 121.6),
  pd('pd-180', 'PD180', 96, 640, 496, 187.2),
].map(completar);

export const MODO_POR_VIS = new Map(MODOS.map((modo) => [modo.vis, modo]));

export function buscarModo(id) {
  return MODOS.find((modo) => modo.id === id) ?? null;
}
