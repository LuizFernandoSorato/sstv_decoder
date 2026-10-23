// Conversão de cor BT.601 (faixa de estúdio), usada pelos modos Robot e PD.
// Valores de entrada e saída em 0–255.

const limitar = (valor) => (valor < 0 ? 0 : valor > 255 ? 255 : valor);

export function rgbParaYcc(r, g, b) {
  return [
    16 + (65.738 * r + 129.057 * g + 25.064 * b) / 256,
    128 + (112.439 * r - 94.154 * g - 18.285 * b) / 256,
    128 + (-37.945 * r - 74.494 * g + 112.439 * b) / 256,
  ];
}

// cr = R-Y, cb = B-Y
export function yccParaRgb(y, cr, cb) {
  const luma = 298.082 * (y - 16);
  return [
    limitar((luma + 408.583 * (cr - 128)) / 256),
    limitar((luma - 100.291 * (cb - 128) - 208.12 * (cr - 128)) / 256),
    limitar((luma + 516.411 * (cb - 128)) / 256),
  ];
}
