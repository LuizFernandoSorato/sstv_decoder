// Service worker do PWA: permite abrir o app sem internet.
//
// Estratégia "rede primeiro": online, sempre busca a versão mais nova (e
// atualiza o cache); offline, usa o que estiver no cache. Assim uma
// atualização do app nunca fica presa atrás de um cache antigo.
// Caminhos relativos: funciona também hospedado num subdiretório.

const CACHE = 'sstv-v1';
const ARQUIVOS_DO_APP = [
  './',
  'index.html',
  'estilo.css',
  'manifesto.webmanifest',
  'icones/icone-192.png',
  'icones/icone-512.png',
  'icones/icone-mascaravel-512.png',
  'icones/icone-apple-180.png',
  'src/interface.js',
  'src/entrada-audio.js',
  'src/processador-microfone.js',
  'src/decodificador.js',
  'src/dsp.js',
  'src/vis.js',
  'src/modos.js',
  'src/inclinacao.js',
  'src/cores.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ARQUIVOS_DO_APP)));
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((nome) => nome !== CACHE).map((nome) => caches.delete(nome))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;
  evento.respondWith(redePrimeiro(pedido));
});

async function redePrimeiro(pedido) {
  const cache = await caches.open(CACHE);
  try {
    const resposta = await fetch(pedido);
    if (resposta.ok) cache.put(pedido, resposta.clone());
    return resposta;
  } catch (erro) {
    const guardada = await cache.match(pedido, { ignoreSearch: true });
    if (guardada) return guardada;
    if (pedido.mode === 'navigate') return cache.match('index.html');
    throw erro;
  }
}
