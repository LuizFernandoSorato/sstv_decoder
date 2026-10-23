import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODOS } from '../src/modos.js';
import { codificar } from '../src/codificador.js';
import { padraoDeTeste } from '../ferramentas/sinal-teste.js';
import { decodificarTudo, psnr } from './auxiliares.js';

const TAXA = 48000;
const MARGEM = 4;

for (const modo of MODOS) {
  test(`ida e volta: ${modo.nome}`, () => {
    const original = padraoDeTeste(modo.largura, modo.altura);
    const { imagens } = decodificarTudo(codificar(modo, original, TAXA), TAXA);
    assert.equal(imagens.length, 1);
    const [imagem] = imagens;
    assert.equal(imagem.modo.id, modo.id);
    assert.equal(imagem.linhas, modo.altura);
    const interior = psnr(original.dados, imagem.imagem, modo.largura, { margem: MARGEM });
    const total = psnr(original.dados, imagem.imagem, modo.largura);
    assert.ok(interior >= 35, `PSNR interior ${interior.toFixed(1)} dB`);
    assert.ok(total >= 25, `PSNR total ${total.toFixed(1)} dB`);
  });
}
