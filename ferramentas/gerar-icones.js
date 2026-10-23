// Gera os ícones do PWA (barras de cor SSTV sobre uma onda) sem dependências.
// Uso: node ferramentas/gerar-icones.js

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const FUNDO = [17, 21, 28];
const ONDA = [140, 190, 255];
const BARRAS = [
  [235, 235, 235], [235, 220, 40], [40, 210, 225], [40, 200, 70],
  [215, 60, 200], [225, 50, 45], [45, 80, 225],
];

/**
 * Desenha o ícone em RGBA. `areaUtil` é a fração do lado ocupada pelo desenho:
 * ícones "maskable" precisam deixar margem, pois o sistema recorta as bordas.
 */
function desenharIcone(lado, areaUtil) {
  const dados = new Uint8Array(lado * lado * 4);
  const caixa = lado * areaUtil;
  const x0 = (lado - caixa) / 2;
  const y0 = (lado - caixa) / 2;
  const alturaBarras = caixa * 0.58;
  const espessura = caixa * 0.045;
  const amplitude = caixa * 0.1;
  const centroOnda = y0 + alturaBarras + (caixa - alturaBarras) / 2;
  const onda = (x) => centroOnda - amplitude * Math.sin((2 * Math.PI * 2 * (x - x0)) / caixa);
  const derivada = (x) => (-amplitude * 2 * Math.PI * 2 * Math.cos((2 * Math.PI * 2 * (x - x0)) / caixa)) / caixa;

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let cor = FUNDO;
      const dentro = px >= x0 && px < x0 + caixa;
      if (dentro && py >= y0 && py < y0 + alturaBarras) {
        cor = BARRAS[Math.min(BARRAS.length - 1, Math.floor(((px - x0) / caixa) * BARRAS.length))];
      } else if (dentro && py >= y0 + alturaBarras && py < y0 + caixa) {
        // distância aproximada até a curva, com borda suave (antisserrilhado)
        const distancia = Math.abs(py - onda(px)) / Math.sqrt(1 + derivada(px) ** 2);
        const cobertura = Math.min(1, Math.max(0, espessura / 2 + 0.5 - distancia));
        cor = FUNDO.map((c, i) => Math.round(c + (ONDA[i] - c) * cobertura));
      }
      dados.set([...cor, 255], (y * lado + x) * 4);
    }
  }
  return dados;
}

function pedaco(tipo, conteudo) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(conteudo.length);
  const tipoEConteudo = Buffer.concat([Buffer.from(tipo, 'ascii'), conteudo]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoEConteudo));
  return Buffer.concat([tamanho, tipoEConteudo, crc]);
}

function paraPng(lado, rgba) {
  const cabecalho = Buffer.alloc(13);
  cabecalho.writeUInt32BE(lado, 0);
  cabecalho.writeUInt32BE(lado, 4);
  cabecalho.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, sem entrelaçamento
  const linhas = Buffer.alloc((lado * 4 + 1) * lado);
  for (let y = 0; y < lado; y++) {
    linhas[y * (lado * 4 + 1)] = 0; // filtro "nenhum"
    linhas.set(rgba.subarray(y * lado * 4, (y + 1) * lado * 4), y * (lado * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', cabecalho),
    pedaco('IDAT', deflateSync(linhas, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

const ICONES = [
  { arquivo: 'icone-192.png', lado: 192, areaUtil: 0.8 },
  { arquivo: 'icone-512.png', lado: 512, areaUtil: 0.8 },
  { arquivo: 'icone-mascaravel-512.png', lado: 512, areaUtil: 0.6 },
  { arquivo: 'icone-apple-180.png', lado: 180, areaUtil: 0.72 },
];

mkdirSync('icones', { recursive: true });
for (const { arquivo, lado, areaUtil } of ICONES) {
  writeFileSync(`icones/${arquivo}`, paraPng(lado, desenharIcone(lado, areaUtil)));
  console.log(`icones/${arquivo}`);
}
