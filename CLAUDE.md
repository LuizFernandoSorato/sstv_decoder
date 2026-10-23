# CLAUDE.md

Decodificador SSTV leve que roda no navegador. Aceita áudio do microfone/entrada de linha (tempo real) ou de arquivos (.wav, .mp3, .ogg, .flac, .m4a) e desenha a imagem linha a linha num canvas, com exportação para PNG.

## Princípios

- **Tudo em português**: nomes de arquivos, identificadores, comentários, mensagens de teste e textos da interface (pt-BR). Sem acentos em identificadores.
- **Leveza acima de tudo**: JavaScript puro (ES modules), sem framework, sem bundler, sem dependências. A pasta do projeto é o app.
- **Sem ffmpeg**: arquivos são decodificados pelo navegador (`OfflineAudioContext.decodeAudioData`).
- **DSP independente do DOM**: `dsp.js`, `vis.js`, `modos.js`, `decodificador.js`, `inclinacao.js`, `cores.js` e `codificador.js` rodam no navegador e no Node. Nada de `window`, `document` ou `AudioContext` neles.
- **Taxa de amostragem nunca fixa no código**: o decodificador recebe a taxa de entrada e converte tempos com `this.amostras(ms)`.

## Estrutura

```
index.html                  # página única
estilo.css                  # tema claro/escuro por variáveis CSS
manifesto.webmanifest       # PWA: nome, ícones, display standalone
servico-offline.js          # service worker: rede primeiro, cache como reserva
icones/                     # gerados por ferramentas/gerar-icones.js
src/
  interface.js              # liga entrada ↔ decodificador ↔ canvas, galeria, cascata
  entrada-audio.js          # arquivo/microfone → Float32Array mono
  processador-microfone.js  # AudioWorklet: agrupa quadros do microfone em blocos
  dsp.js                    # Demodulador (FM em quadratura, 2 filtros), combinarDetalhe (Wiener), média móvel, mediana
  vis.js                    # detecção e leitura do código VIS
  modos.js                  # tabelas de tempo dos modos (dados puros)
  decodificador.js          # máquina de estados: BUSCA_VIS / BUSCA_SYNC → LINHAS
  inclinacao.js             # reta robusta (Theil–Sen + mínimos quadrados) nos syncs
  cores.js                  # RGB ↔ YCrCb (BT.601)
  codificador.js            # gera áudio SSTV (testes e exemplos)
ferramentas/
  gerar-wav.js              # CLI: gera .wav de exemplo com o padrão de teste
  gerar-icones.js           # CLI: gera os PNG dos ícones (encoder PNG próprio, sem dependências)
  sinal-teste.js            # padraoDeTeste (suave), padraoDeNitidez (barras/listras/xadrez), escrita de WAV
testes/
  ida-e-volta.test.js       # todos os modos, padrão suave, PSNR
  qualidade.test.js         # nitidez, saturação, redução de ruído
  decodificador.test.js     # relógio, sintonia, ruído forte, manual, cortado, duas imagens
  vis.test.js, modos.test.js
  auxiliares.js             # decodificarTudo, psnr, medirNitidez, adicionarRuido
```

## Comandos

```bash
npm run servir      # http://localhost:8080 (ES modules e AudioWorklet não funcionam via file://)
npm test            # node --test, arquivos em paralelo, ~1 min
node --test testes/vis.test.js                     # um arquivo só
node ferramentas/gerar-wav.js robot-36 exemplos/robot-36-nitidez.wav [taxa] [suave|nitidez]
```

Microfone e PWA exigem contexto seguro: `http://localhost` funciona, IP da rede local não. No celular, só com o app hospedado em HTTPS.

## PWA

- `servico-offline.js` usa **rede primeiro**: online sempre pega a versão nova; offline, o cache. Não trocar para "cache primeiro" — atualizações ficariam presas atrás do cache antigo.
- **Arquivo novo em `src/` (ou qualquer arquivo do app) precisa entrar em `ARQUIVOS_DO_APP`** no service worker, senão não abre offline. `codificador.js` fica de fora de propósito (só testes/ferramentas usam).
- Caminhos relativos no manifesto e no service worker: o app pode ser hospedado num subdiretório (ex.: GitHub Pages `/repositorio/`).
- Celular: `manterTelaLigada()` (Wake Lock) durante o microfone, porque com a tela bloqueada o navegador pausa o áudio; botão "Compartilhar" (Web Share) na galeria, porque `<a download>` falha em PWA no iPhone.

## Pipeline

1. **Demodulação** (`Demodulador`): mistura com 1900 Hz → dois passa-baixas FIR sobre a mesma mistura, **estreito** (1000 Hz) e **largo** (2000 Hz), ambos 4 ms Hamming e com o mesmo número de coeficientes (saídas alinhadas) → decimação para ~15–22 kHz → frequência pela diferença de fase entre amostras complexas. Funciona em streaming. O estreito vai para `historico` (VIS, sync, base dos pixels); o largo, para `historicoLargo` (detalhe).
2. **VIS**: procura ~250 ms de leader (1900) seguido de start bit (1200) na frequência suavizada (2 ms); lê os 8 bits pela média de cada janela; confere paridade par; estima o erro de sintonia pela mediana do leader.
3. **Sync**: pontuação por janela deslizante sobre pesos (1 em ≤1300 Hz, 0 em ≥1450 Hz) da frequência suavizada (1 ms); depois **refina pela borda final** (cruzamento de 1350 Hz no fim do sync), que é sempre 1200→1500 Hz em todos os modos.
4. **Inclinação**: cada sync encontrado vira (n, p); `ajustarReta` dá `p = a + b·n` (Theil–Sen a partir de 3 pontos, refinado por mínimos quadrados com ≥10). `b/periodoNominal` é o erro de relógio (limitado a ±1,5%).
5. **Pixels**: para cada pixel, média da frequência no intervalo do pixel nos dois históricos. `base` = estreito, `detalhe` = largo − estreito. `combinarDetalhe` aplica um Wiener local (janela de 7 px): `base + ganho·detalhe`, com ganho ≈ 1 onde o detalhe supera o ruído e ≈ 0 em áreas lisas ruidosas. A variância do ruído do detalhe é **medida no interior de cada sync** (tom constante) para janelas de 1–32 amostras (`medirRuidoDetalhe`). Sinal limpo → resultado = filtro largo. Depois `(f − desvio − 1500) · 255/800`. Ao concluir, a imagem inteira é redesenhada com a reta e a estimativa de ruído finais.
6. **Cor**: família `rgb` (Martin/Scottie) direto; família `ycc` (Robot/PD) via `yccParaRgb`. Unidades de 2 linhas (Robot 36, PD) usam `Y0`/`Y1` com croma compartilhado.

## Modos

Cada modo descreve uma **unidade de varredura** (o trecho que se repete) em `segmentos` (`sync`, `tom`, `canal`). Campos derivados: `periodo`, `deslocSync`, `duracaoSync`, `inicio` de cada segmento. Modos novos entram só como dados em `src/modos.js`; o decodificador não pode ter `if` por modo, só por `familia`.

| Modo | VIS | Resolução | Unidade |
|---|---|---|---|
| Martin M1 / M2 | 44 / 40 | 320×256 | sync 4.862 · porch 0.572 · G · sep · B · sep · R · sep (canais 146.432 / 73.216) |
| Scottie S1 / S2 / DX | 60 / 56 / 76 | 320×256 | sep 1.5 · G · sep · B · sync 9 · porch 1.5 · R (canais 138.24 / 88.064 / 345.6) + sync inicial 9 ms |
| Robot 36 | 8 | 320×240 | 2 linhas: [sync 9 · porch 3 · Y 88 · sep 4.5 (1500) · porch 1.5 · R-Y 44] + [… Y 88 · sep 4.5 (2300) · … B-Y 44] |
| Robot 72 | 12 | 320×240 | sync 9 · porch 3 · Y 138 · sep · porch · R-Y 69 · sep · porch · B-Y 69 |
| PD90 / PD120 / PD180 | 99 / 95 / 96 | 320×256 / 640×496 / 640×496 | 2 linhas: sync 20 · porch 2.08 · Y0 · R-Y · B-Y · Y1 (170.24 / 121.6 / 187.2) |

VIS: leader 1900 Hz 300 ms → break 1200 Hz 10 ms → leader 300 ms → start bit 1200 Hz 30 ms → 7 bits LSB primeiro + paridade par (1100 Hz = 1, 1300 Hz = 0), 30 ms cada → stop bit 1200 Hz 30 ms.

## Armadilhas conhecidas

- **Microfone**: `echoCancellation`, `noiseSuppression` e `autoGainControl` precisam ficar `false`, senão o sinal é destruído.
- O `AudioContext` do microfone roda na taxa do hardware (44,1 ou 48 kHz): sempre use `contexto.sampleRate`.
- Navegadores bloqueiam `AudioContext` sem gesto do usuário: o microfone só abre a partir do clique.
- **Tolerância de empate no sync**: deve ser mínima (0,5). Uma folga maior faz cada linha "puxar" para a previsão e o erro inicial nunca é corrigido (aconteceu com 3%: PD120 caiu de 42 para 30 dB).
- **Borda inicial do sync não serve de referência**: depende do último pixel da linha anterior e desloca ~0,25 ms. Use a borda final.
- **Inclinação com poucos pontos**: usar só a nominal até ter 10 syncs faz a previsão escorregar para fora da janela com relógio 0,5% fora. Por isso Theil–Sen já a partir de 3.
- As 1–2 colunas das bordas de cada canal sempre perdem nitidez (o filtro borra a transição para o tom vizinho). Os testes medem PSNR com margem de 4 px por isso.
- **Padrão suave não mede nitidez**: com só o filtro estreito o PSNR do `padraoDeTeste` era ótimo enquanto listras de 1 px sumiam e a imagem real ficava borrada. Qualquer mudança de banda/filtro precisa olhar `qualidade.test.js` (`padraoDeNitidez`).
- **Imagem "pálida" com ruído**: o corte em 0–255 come só metade do ruído nos extremos (branco escurece, preto clareia, cores desbotam). Não é viés do estimador (corrigir o viés de autocorrelação foi testado e não muda nada); o remédio é menos ruído por pixel.
- **V8 no laço do demodulador**: o laço FIR fica numa função de módulo (`filtrarEMedirFrequencia`) e o estado `anteriorRe/Im` nasce com valor não inteiro. Dentro de fechamento, ou com estado nascendo inteiro, o código ficava 2–4× mais lento. Somar pares do FIR simétrico não ajuda (o laço é limitado por memória).

## Convenções de teste

- Toda mudança no decodificador deve passar no teste de ida e volta (`testes/ida-e-volta.test.js`): codificar o padrão de teste, decodificar e exigir PSNR interior ≥ 35 dB em áudio limpo, para **todos** os modos.
- E nos testes de qualidade (`testes/qualidade.test.js`): saturação das barras e contraste das listras de 1/2/4/8 px, limpo e com ruído.
- Ao mexer em DSP, rode também os cenários de relógio fora, sintonia fora, ruído forte, modo manual, áudio cortado e duas imagens seguidas (`testes/decodificador.test.js`).
- Referências atuais (48 kHz, Robot 36): limpo → listras 1/2/4/8 px = 65/80/90/94%, saturação 100%; ruído σ=0,1 → 60/69/79/86%, saturação 96%, padrão suave 22 dB (só estreito: 23,4; só largo: 15,6). Martin M1 limpo → 78/88/94/97%.
