// Entrada de áudio no navegador: arquivos e microfone → Float32Array mono.

const TAXA_ARQUIVO = 48000;

/** Decodifica um arquivo de áudio (wav, mp3, ogg, flac, m4a...) usando o próprio navegador. */
export async function lerArquivoDeAudio(arquivo) {
  const dados = await arquivo.arrayBuffer();
  // OfflineAudioContext não exige gesto do usuário e fixa a taxa de reamostragem.
  const contexto = new OfflineAudioContext(1, 1, TAXA_ARQUIVO);
  const buffer = await contexto.decodeAudioData(dados);
  return { amostras: misturarParaMono(buffer), taxa: buffer.sampleRate, duracao: buffer.duration };
}

function misturarParaMono(buffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const canal = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += canal[i] / buffer.numberOfChannels;
  }
  return mono;
}

export async function listarMicrofones() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const dispositivos = await navigator.mediaDevices.enumerateDevices();
  return dispositivos
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default')
    .map((d, i) => ({ id: d.deviceId, nome: d.label || `Entrada ${i + 1}` }));
}

/**
 * Abre o microfone (ou a entrada de linha) e entrega blocos de amostras.
 * Deve ser chamado a partir de um clique: o navegador bloqueia áudio sem gesto.
 */
export async function abrirMicrofone({ idDispositivo = '', aoReceber }) {
  const fluxo = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: idDispositivo ? { exact: idDispositivo } : undefined,
      channelCount: 1,
      // Com qualquer um destes ligado, o sinal SSTV é destruído.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const contexto = new AudioContext();
  try {
    await contexto.audioWorklet.addModule(new URL('./processador-microfone.js', import.meta.url));
  } catch (erro) {
    fluxo.getTracks().forEach((faixa) => faixa.stop());
    contexto.close();
    throw erro;
  }

  const fonte = contexto.createMediaStreamSource(fluxo);
  const processador = new AudioWorkletNode(contexto, 'processador-microfone');
  processador.port.onmessage = (evento) => aoReceber(evento.data);

  const analisador = contexto.createAnalyser();
  analisador.fftSize = 4096;
  analisador.smoothingTimeConstant = 0;

  // Alguns navegadores só processam nós ligados ao destino: ganho zero evita eco.
  const mudo = contexto.createGain();
  mudo.gain.value = 0;
  fonte.connect(processador).connect(mudo).connect(contexto.destination);
  fonte.connect(analisador);
  await contexto.resume();

  return {
    taxa: contexto.sampleRate,
    analisador,
    parar() {
      processador.port.onmessage = null;
      fluxo.getTracks().forEach((faixa) => faixa.stop());
      contexto.close();
    },
  };
}
