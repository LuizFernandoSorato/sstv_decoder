// Interface: liga arquivo/microfone ao decodificador e desenha os resultados.

import { Decodificador } from './decodificador.js';
import { MODOS } from './modos.js';
import { lerArquivoDeAudio, abrirMicrofone, listarMicrofones } from './entrada-audio.js';

const $ = (id) => document.getElementById(id);
const elementos = {
  arquivo: $('arquivo'),
  botaoMicrofone: $('botao-microfone'),
  botaoParar: $('botao-parar'),
  botaoSalvar: $('botao-salvar'),
  dispositivo: $('dispositivo'),
  modo: $('modo'),
  status: $('status'),
  progresso: $('progresso'),
  canvas: $('imagem'),
  infoImagem: $('info-imagem'),
  painelCascata: $('painel-cascata'),
  cascata: $('cascata'),
  marcas: $('marcas-cascata'),
  galeria: $('galeria'),
  soltar: $('soltar'),
};
const contexto2d = elementos.canvas.getContext('2d');

const FAIXA_CASCATA = { minima: 900, maxima: 2600 };
const MARCAS_CASCATA = [[1200, 'sync'], [1500, 'preto'], [1900, 'VIS'], [2300, 'branco']];
const BLOCO_ARQUIVO_SEGUNDOS = 0.5;

let sessao = null; // { parar(): void }

// ------------------------------------------------------------------ status

function definirStatus(texto, progresso = null) {
  elementos.status.textContent = texto;
  if (progresso === null) elementos.progresso.removeAttribute('value');
  else elementos.progresso.value = progresso;
}

function alternarSessao(ativa) {
  elementos.botaoParar.disabled = !ativa;
  elementos.botaoMicrofone.disabled = ativa;
  elementos.modo.disabled = ativa;
}

// ------------------------------------------------------------- decodificador

function criarDecodificador(taxa, { aoProgredir, aoImagem } = {}) {
  const modo = elementos.modo.value === 'auto' ? null : elementos.modo.value;
  return new Decodificador({
    taxaAmostragem: taxa,
    modo,
    aoDetectarModo: ({ modo: detectado, desvio, origem }) => {
      prepararCanvas(detectado);
      const sintonia = Math.abs(desvio) >= 10 ? ` · sintonia ${desvio > 0 ? '+' : ''}${desvio.toFixed(0)} Hz` : '';
      elementos.infoImagem.textContent = `${detectado.nome} · ${detectado.largura}×${detectado.altura}${sintonia}`;
      definirStatus(`${detectado.nome} detectado (${origem === 'vis' ? 'pelo código VIS' : 'pelos pulsos de sync'}). Recebendo…`, 0);
    },
    aoAtualizar: ({ imagem, largura, altura, linhaInicial, linhaFinal, modo: atual }) => {
      contexto2d.putImageData(new ImageData(imagem, largura, altura), 0, 0, 0, linhaInicial, largura, linhaFinal - linhaInicial);
      aoProgredir?.(linhaFinal / altura);
      if (!aoProgredir) definirStatus(`Recebendo ${atual.nome}: linha ${linhaFinal} de ${altura}`, linhaFinal / altura);
    },
    aoConcluir: (resultado) => {
      contexto2d.putImageData(new ImageData(resultado.imagem, resultado.largura, resultado.altura), 0, 0);
      adicionarNaGaleria(resultado);
      elementos.botaoSalvar.disabled = false;
      const relogio = (Math.round((resultado.relogio - 1) * 10000) / 100 || 0)
        .toLocaleString('pt-BR', { minimumFractionDigits: 2, signDisplay: 'exceptZero' });
      definirStatus(`${resultado.modo.nome} concluído: ${resultado.linhas} linhas, relógio ${relogio}% (inclinação corrigida).`, 1);
      aoImagem?.(resultado);
    },
    aoDescartar: ({ motivo }) => definirStatus(`Imagem descartada. ${motivo}`),
    aoVisDesconhecido: (codigo) => definirStatus(`Código VIS ${codigo} recebido, mas esse modo ainda não é suportado.`),
  });
}

function prepararCanvas(modo) {
  elementos.canvas.width = modo.largura;
  elementos.canvas.height = modo.altura;
  contexto2d.fillStyle = '#000';
  contexto2d.fillRect(0, 0, modo.largura, modo.altura);
  elementos.botaoSalvar.disabled = true;
}

// ----------------------------------------------------------------- arquivo

async function decodificarArquivo(arquivo) {
  encerrarSessao();
  definirStatus(`Lendo "${arquivo.name}"…`);
  let audio;
  try {
    audio = await lerArquivoDeAudio(arquivo);
  } catch {
    definirStatus(`Não foi possível ler "${arquivo.name}". Verifique se é um arquivo de áudio suportado pelo navegador.`, 0);
    return;
  }

  let cancelada = false;
  sessao = { parar: () => { cancelada = true; } };
  alternarSessao(true);

  let imagens = 0;
  let linhaAtual = null;
  const decodificador = criarDecodificador(audio.taxa, {
    aoProgredir: (fracao) => { linhaAtual = fracao; },
    aoImagem: () => {
      imagens++;
      linhaAtual = null;
    },
  });

  const bloco = Math.round(audio.taxa * BLOCO_ARQUIVO_SEGUNDOS);
  for (let i = 0; i < audio.amostras.length && !cancelada; i += bloco) {
    decodificador.processar(audio.amostras.subarray(i, i + bloco));
    const lido = Math.min(1, (i + bloco) / audio.amostras.length);
    const imagem = linhaAtual === null ? '' : ` · imagem ${Math.round(linhaAtual * 100)}%`;
    definirStatus(`Decodificando "${arquivo.name}": ${Math.round(lido * 100)}% do áudio${imagem}`, lido);
    await new Promise((resolver) => setTimeout(resolver, 0));
  }
  if (cancelada) {
    definirStatus('Decodificação interrompida.');
    return;
  }

  decodificador.finalizar();
  sessao = null;
  alternarSessao(false);
  if (imagens === 0) {
    const dica = elementos.modo.value === 'auto' ? ' Se o áudio começa no meio da transmissão, escolha o modo manualmente.' : '';
    definirStatus(`Nenhuma imagem SSTV encontrada em "${arquivo.name}".${dica}`, 0);
  } else {
    definirStatus(`"${arquivo.name}": ${imagens} ${imagens === 1 ? 'imagem decodificada' : 'imagens decodificadas'}.`, 1);
  }
}

// --------------------------------------------------------------- microfone

async function iniciarMicrofone() {
  encerrarSessao();
  if (!window.isSecureContext) {
    definirStatus('O microfone só funciona em https ou em http://localhost.');
    return;
  }
  definirStatus('Pedindo acesso ao microfone…');

  let decodificador = null;
  let microfone;
  try {
    microfone = await abrirMicrofone({
      idDispositivo: elementos.dispositivo.value,
      aoReceber: (bloco) => decodificador?.processar(bloco),
    });
  } catch (erro) {
    const negado = erro?.name === 'NotAllowedError';
    definirStatus(negado ? 'Acesso ao microfone negado. Libere a permissão no navegador e tente de novo.' : `Não foi possível abrir o microfone: ${erro?.message ?? erro}`);
    return;
  }

  decodificador = criarDecodificador(microfone.taxa);
  const pararCascata = iniciarCascata(microfone.analisador, microfone.taxa);
  const liberarTela = manterTelaLigada();
  sessao = {
    parar: () => {
      liberarTela();
      pararCascata();
      microfone.parar();
      decodificador.finalizar();
    },
  };
  alternarSessao(true);
  atualizarDispositivos();
  const espera = elementos.modo.value === 'auto' ? 'aguardando o código VIS' : 'aguardando pulsos de sync';
  definirStatus(`Ouvindo (${microfone.taxa} Hz), ${espera}…`);
}

/**
 * No celular, com a tela bloqueada o navegador pausa a página e o áudio do
 * microfone deixa de chegar. Mantém a tela ligada enquanto escuta (o sistema
 * solta a trava quando a página some; ela é pedida de novo ao voltar).
 */
function manterTelaLigada() {
  if (!('wakeLock' in navigator)) return () => {};
  let trava = null;
  let ativa = true;
  const pedir = async () => {
    if (!ativa || document.visibilityState !== 'visible') return;
    try {
      trava = await navigator.wakeLock.request('screen');
    } catch {
      // sem permissão ou bateria fraca: segue sem a trava
    }
  };
  document.addEventListener('visibilitychange', pedir);
  pedir();
  return () => {
    ativa = false;
    document.removeEventListener('visibilitychange', pedir);
    trava?.release();
  };
}

function encerrarSessao() {
  if (!sessao) return;
  const atual = sessao;
  sessao = null;
  atual.parar();
  alternarSessao(false);
}

// Cascata (waterfall) da faixa SSTV, para conferir sintonia e nível.
function iniciarCascata(analisador, taxa) {
  elementos.painelCascata.hidden = false;
  const canvas = elementos.cascata;
  const contexto = canvas.getContext('2d');
  const espectro = new Float32Array(analisador.frequencyBinCount);
  const hzPorBin = taxa / analisador.fftSize;
  const linha = contexto.createImageData(canvas.width, 1);
  let ativo = true;

  const desenhar = () => {
    if (!ativo) return;
    analisador.getFloatFrequencyData(espectro);
    contexto.drawImage(canvas, 0, 1);
    for (let x = 0; x < canvas.width; x++) {
      const freq = FAIXA_CASCATA.minima + ((FAIXA_CASCATA.maxima - FAIXA_CASCATA.minima) * x) / (canvas.width - 1);
      const intensidade = Math.min(1, Math.max(0, (espectro[Math.round(freq / hzPorBin)] + 100) / 70));
      const [r, g, b] = corDaCascata(intensidade);
      linha.data.set([r, g, b, 255], x * 4);
    }
    contexto.putImageData(linha, 0, 0);
    requestAnimationFrame(desenhar);
  };
  desenhar();
  return () => { ativo = false; };
}

function corDaCascata(t) {
  // azul escuro → ciano → amarelo → branco
  const paradas = [[8, 12, 40], [0, 140, 200], [250, 220, 60], [255, 255, 255]];
  const posicao = t * (paradas.length - 1);
  const i = Math.min(paradas.length - 2, Math.floor(posicao));
  const f = posicao - i;
  return paradas[i].map((valor, c) => valor + (paradas[i + 1][c] - valor) * f);
}

function desenharMarcasCascata() {
  for (const [freq, rotulo] of MARCAS_CASCATA) {
    const marca = document.createElement('span');
    marca.className = 'marca';
    marca.style.left = `${(100 * (freq - FAIXA_CASCATA.minima)) / (FAIXA_CASCATA.maxima - FAIXA_CASCATA.minima)}%`;
    marca.textContent = `${freq} ${rotulo}`;
    elementos.marcas.append(marca);
  }
}

// ----------------------------------------------------------------- galeria

function nomeDoArquivo(modo) {
  const agora = new Date();
  const doisDigitos = (n) => String(n).padStart(2, '0');
  const data = `${agora.getFullYear()}${doisDigitos(agora.getMonth() + 1)}${doisDigitos(agora.getDate())}`;
  const hora = `${doisDigitos(agora.getHours())}${doisDigitos(agora.getMinutes())}${doisDigitos(agora.getSeconds())}`;
  return `sstv-${modo.id}-${data}-${hora}.png`;
}

function adicionarNaGaleria(resultado) {
  elementos.galeria.querySelector('.vazio')?.remove();
  const url = elementos.canvas.toDataURL('image/png');
  const figura = document.createElement('figure');
  const imagem = document.createElement('img');
  imagem.src = url;
  imagem.alt = `Imagem ${resultado.modo.nome} decodificada`;
  const legenda = document.createElement('figcaption');
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeDoArquivo(resultado.modo);
  link.textContent = 'Baixar PNG';
  legenda.append(`${resultado.modo.nome} · ${new Date().toLocaleTimeString('pt-BR')} `, link);
  adicionarBotaoCompartilhar(legenda, url, link.download);
  figura.append(imagem, legenda);
  elementos.galeria.prepend(figura);
}

// No celular (sobretudo no iPhone instalado como app) o link de download
// costuma não funcionar: o compartilhamento do sistema salva na galeria.
async function adicionarBotaoCompartilhar(legenda, url, nome) {
  if (!navigator.canShare) return;
  const arquivo = new File([await (await fetch(url)).blob()], nome, { type: 'image/png' });
  if (!navigator.canShare({ files: [arquivo] })) return;
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = 'link';
  botao.textContent = 'Compartilhar';
  botao.addEventListener('click', () => navigator.share({ files: [arquivo], title: 'Imagem SSTV' }).catch(() => {}));
  legenda.append(' · ', botao);
}

function salvarImagemAtual() {
  const link = document.createElement('a');
  link.href = elementos.canvas.toDataURL('image/png');
  link.download = 'sstv.png';
  link.click();
}

// ------------------------------------------------------------ dispositivos

async function atualizarDispositivos() {
  const selecionado = elementos.dispositivo.value;
  const microfones = await listarMicrofones();
  elementos.dispositivo.replaceChildren(new Option('Padrão do sistema', ''));
  for (const { id, nome } of microfones) elementos.dispositivo.append(new Option(nome, id));
  elementos.dispositivo.value = microfones.some((m) => m.id === selecionado) ? selecionado : '';
}

// ----------------------------------------------------------------- eventos

function configurarArrastarESoltar() {
  let profundidade = 0;
  document.addEventListener('dragenter', (evento) => {
    if (!evento.dataTransfer?.types.includes('Files')) return;
    profundidade++;
    elementos.soltar.hidden = false;
  });
  document.addEventListener('dragleave', () => {
    profundidade = Math.max(0, profundidade - 1);
    if (profundidade === 0) elementos.soltar.hidden = true;
  });
  document.addEventListener('dragover', (evento) => evento.preventDefault());
  document.addEventListener('drop', (evento) => {
    evento.preventDefault();
    profundidade = 0;
    elementos.soltar.hidden = true;
    const arquivo = evento.dataTransfer?.files[0];
    if (arquivo) decodificarArquivo(arquivo);
  });
}

function iniciar() {
  for (const modo of MODOS) elementos.modo.append(new Option(`${modo.nome} (${modo.largura}×${modo.altura})`, modo.id));
  desenharMarcasCascata();
  configurarArrastarESoltar();

  elementos.arquivo.addEventListener('change', () => {
    const [arquivo] = elementos.arquivo.files;
    elementos.arquivo.value = '';
    if (arquivo) decodificarArquivo(arquivo);
  });
  elementos.botaoMicrofone.addEventListener('click', iniciarMicrofone);
  elementos.botaoParar.addEventListener('click', () => {
    encerrarSessao();
    elementos.painelCascata.hidden = true;
    definirStatus('Parado.');
  });
  elementos.botaoSalvar.addEventListener('click', salvarImagemAtual);
  navigator.mediaDevices?.addEventListener?.('devicechange', atualizarDispositivos);

  atualizarDispositivos();
  registrarServicoOffline();
  definirStatus('Pronto. Abra um arquivo de áudio, arraste-o para a página ou inicie o microfone.', 0);
}

/** Habilita uso offline e instalação como app (PWA). Só funciona em https ou localhost. */
function registrarServicoOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register(new URL('../servico-offline.js', import.meta.url)).catch((erro) => {
    console.warn('Service worker não registrado:', erro);
  });
}

iniciar();
