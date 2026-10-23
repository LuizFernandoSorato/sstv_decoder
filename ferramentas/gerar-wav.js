// Gera um .wav SSTV com um padrão de teste, para experimentar a interface.
// Uso: node ferramentas/gerar-wav.js <modo> <saida.wav> [taxa] [padrao]
//   padrao: "suave" (gradientes, padrão) ou "nitidez" (barras de cor, listras finas, xadrez)
// Exemplo: node ferramentas/gerar-wav.js robot-36 exemplos/robot-36-nitidez.wav 44100 nitidez

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MODOS, buscarModo } from '../src/modos.js';
import { codificar } from '../src/codificador.js';
import { padraoDeTeste, padraoDeNitidez, paraWav } from './sinal-teste.js';

const PADROES = { suave: padraoDeTeste, nitidez: padraoDeNitidez };

const [idModo, saida, taxaTexto = '44100', nomePadrao = 'suave'] = process.argv.slice(2);
const modo = buscarModo(idModo);
const padrao = PADROES[nomePadrao];
if (!modo || !saida || !padrao) {
  console.error('Uso: node ferramentas/gerar-wav.js <modo> <saida.wav> [taxa] [padrao]');
  console.error(`Modos: ${MODOS.map((m) => m.id).join(', ')}`);
  console.error(`Padrões: ${Object.keys(PADROES).join(', ')}`);
  process.exit(1);
}

const taxa = Number(taxaTexto);
const amostras = codificar(modo, padrao(modo.largura, modo.altura), taxa);
mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, paraWav(amostras, taxa));
console.log(`${modo.nome} (${nomePadrao}): ${(amostras.length / taxa).toFixed(1)} s gravados em ${saida}`);
