// AudioWorklet: junta os quadros de 128 amostras do microfone em blocos
// maiores e os envia à thread principal, onde roda o decodificador.

const TAMANHO_BLOCO = 2048;

class ProcessadorMicrofone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bloco = new Float32Array(TAMANHO_BLOCO);
    this.posicao = 0;
  }

  process(entradas) {
    const canal = entradas[0]?.[0];
    if (!canal) return true;
    for (let i = 0; i < canal.length; i++) {
      this.bloco[this.posicao++] = canal[i];
      if (this.posicao === TAMANHO_BLOCO) {
        this.port.postMessage(this.bloco, [this.bloco.buffer]);
        this.bloco = new Float32Array(TAMANHO_BLOCO);
        this.posicao = 0;
      }
    }
    return true;
  }
}

registerProcessor('processador-microfone', ProcessadorMicrofone);
