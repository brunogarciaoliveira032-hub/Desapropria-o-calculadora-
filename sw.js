/* Service worker — cacheia os arquivos locais do app para uso offline.
   Os scripts de CDN (jsPDF, autoTable, SheetJS), usados só nas exportações
   de PDF/Excel, continuam exigindo internet no momento do clique — igual
   ao app original. */

const CACHE_NAME = 'desapropriacao-duarte-v1';
const ARQUIVOS_LOCAIS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './js/util.js',
  './js/motor.js',
  './js/modulos/direta.js',
  './js/modulos/indireta.js',
  './js/indices.js',
  './js/carregador.js',
  './js/completar.js',
  './js/exportarPDF.js',
  './js/exportarExcel.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ARQUIVOS_LOCAIS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nomes =>
      Promise.all(nomes.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Só intercepta pedidos do próprio app (mesma origem); CDNs vão direto à rede.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(respostaCache => {
      const buscaRede = fetch(event.request).then(respostaRede => {
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, respostaRede.clone()));
        return respostaRede;
      }).catch(() => respostaCache);
      return respostaCache || buscaRede;
    })
  );
});
