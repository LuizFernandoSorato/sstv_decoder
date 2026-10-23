// Nitidez, saturação e redução de ruído. O padrão suave da ida e volta não
// enxerga perda de detalhe: foi assim que o filtro estreito apagou linhas de 1 px.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buscarModo } from '../src/modos.js';
import { codificar } from '../src/codificador.js';
import { padraoDeTeste, padraoDeNitidez } from '../ferramentas/sinal-teste.js';
import { decodificarTudo, psnr, adicionarRuido, medirNitidez } from './auxiliares.js';

const TAXA = 48000;

function nitidezDe(idModo, ruido = 0) {
  const modo = buscarModo(idModo);
  const original = padraoDeNitidez(modo.largura, modo.altura);
  let audio = codificar(modo, original, TAXA);
  if (ruido) audio = adicionarRuido(audio, ruido, 3);
  const [imagem] = decodificarTudo(audio, TAXA).imagens;
  return medirNitidez(original.dados, imagem.imagem, modo.largura, modo.altura);
}

const formatar = ({ saturacao, contrastes }) =>
  `saturação ${(saturacao * 100).toFixed(0)}%, listras ${contrastes.map((c) => (c * 100).toFixed(0)).join('/')}%`;

test('nitidez: Robot 36 limpo preserva listras finas e cores saturadas', () => {
  // Com só o filtro estreito, listras de 1 px sumiam (0%) e as de 2 px ficavam em 55%.
  const medida = nitidezDe('robot-36');
  assert.ok(medida.saturacao >= 0.98, formatar(medida));
  assert.ok(medida.contrastes[0] >= 0.55 && medida.contrastes[1] >= 0.75, formatar(medida));
});

test('nitidez: Martin M1 limpo', () => {
  const medida = nitidezDe('martin-m1');
  assert.ok(medida.saturacao >= 0.98, formatar(medida));
  assert.ok(medida.contrastes[0] >= 0.7 && medida.contrastes[1] >= 0.85, formatar(medida));
});

test('nitidez: Robot 36 com ruído mantém detalhe e cor', () => {
  const medida = nitidezDe('robot-36', 0.1);
  assert.ok(medida.saturacao >= 0.93, formatar(medida));
  assert.ok(medida.contrastes[0] >= 0.5 && medida.contrastes[3] >= 0.8, formatar(medida));
});

test('redução de ruído: Robot 36 suave com ruído fica perto do filtro estreito', () => {
  // referência: só o filtro estreito dava 23,4 dB; só o largo, 15,6 dB
  const modo = buscarModo('robot-36');
  const original = padraoDeTeste(320, 240);
  const audio = adicionarRuido(codificar(modo, original, TAXA), 0.1, 3);
  const valor = psnr(original.dados, decodificarTudo(audio, TAXA).imagens[0].imagem, 320, { margem: 4 });
  assert.ok(valor >= 21, `PSNR ${valor.toFixed(1)} dB`);
});
