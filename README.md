# Decodificador SSTV

Decodifica imagens SSTV no navegador, a partir do microfone (em tempo real) ou de arquivos de áudio (.wav, .mp3, .ogg, .flac, .m4a). Nada é enviado para servidor: o áudio e as imagens ficam no aparelho.

Modos: Martin M1/M2, Scottie S1/S2/DX, Robot 36/72, PD90/120/180, com detecção automática pelo código VIS.

## Instalar no celular

Abra o endereço do app no navegador:

- **Android (Chrome):** menu ⋮ → **Instalar app**.
- **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início**.

Depois de instalado, funciona sem internet.

## Rodar localmente

```bash
npm run servir   # http://localhost:8080
npm test
```

Sem dependências nem etapa de build: a pasta do projeto é o app. Para gerar áudios de teste:

```bash
node ferramentas/gerar-wav.js robot-36 exemplos/robot-36.wav
```
