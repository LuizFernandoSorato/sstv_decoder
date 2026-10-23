// Utilitários para gerar sinais de teste: padrão de imagem e gravação em WAV.

/** Imagem RGBA suave (gradientes e senoide), boa para medir PSNR. */
export function padraoDeTeste(largura, altura) {
  const dados = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const posicao = (y * largura + x) * 4;
      dados[posicao] = (255 * x) / (largura - 1);
      dados[posicao + 1] = (255 * y) / (altura - 1);
      dados[posicao + 2] = 127.5 + 127.5 * Math.sin((2 * Math.PI * (x + y)) / (largura / 2));
      dados[posicao + 3] = 255;
    }
  }
  return { largura, altura, dados };
}

export const CORES_BARRAS = [
  [255, 255, 255], [255, 255, 0], [0, 255, 255], [0, 255, 0],
  [255, 0, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0],
];
export const LARGURAS_LISTRAS = [1, 2, 4, 8];

/**
 * Imagem RGBA difícil, para medir nitidez e saturação:
 * terço de cima com barras de cor saturadas; terço do meio com listras
 * preto/branco de 1, 2, 4 e 8 px; terço de baixo com xadrez vermelho/azul.
 */
export function padraoDeNitidez(largura, altura) {
  const dados = new Uint8ClampedArray(largura * altura * 4);
  const terco = Math.floor(altura / 3);
  const faixa = largura / LARGURAS_LISTRAS.length;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      let cor;
      if (y < terco) {
        cor = CORES_BARRAS[Math.floor((x * CORES_BARRAS.length) / largura)];
      } else if (y < 2 * terco) {
        const passo = LARGURAS_LISTRAS[Math.floor(x / faixa)];
        cor = Math.floor(x / passo) % 2 ? [255, 255, 255] : [0, 0, 0];
      } else {
        cor = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? [220, 30, 30] : [30, 30, 220];
      }
      dados.set([...cor, 255], (y * largura + x) * 4);
    }
  }
  return { largura, altura, dados };
}

/** Converte amostras em [-1, 1] num arquivo WAV PCM 16 bits mono. */
export function paraWav(amostras, taxa) {
  const bytes = new Uint8Array(44 + amostras.length * 2);
  const visao = new DataView(bytes.buffer);
  const texto = (posicao, valor) => [...valor].forEach((c, i) => visao.setUint8(posicao + i, c.charCodeAt(0)));
  texto(0, 'RIFF');
  visao.setUint32(4, 36 + amostras.length * 2, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  visao.setUint32(16, 16, true);
  visao.setUint16(20, 1, true); // PCM
  visao.setUint16(22, 1, true); // mono
  visao.setUint32(24, taxa, true);
  visao.setUint32(28, taxa * 2, true);
  visao.setUint16(32, 2, true);
  visao.setUint16(34, 16, true);
  texto(36, 'data');
  visao.setUint32(40, amostras.length * 2, true);
  for (let i = 0; i < amostras.length; i++) {
    const valor = Math.max(-1, Math.min(1, amostras[i]));
    visao.setInt16(44 + i * 2, Math.round(valor * 32767), true);
  }
  return bytes;
}
