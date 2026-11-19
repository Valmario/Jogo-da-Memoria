/*
 * Service worker: deixa o jogo funcionar offline.
 * Estratégia "stale-while-revalidate": responde na hora com o que está em cache
 * e atualiza o cache em segundo plano para a próxima visita.
 *
 * Ao mudar qualquer arquivo do jogo, aumente VERSAO para limpar o cache antigo.
 */
const VERSAO = 'jogo-da-memoria-v2';

const ARQUIVOS = [
    './',
    './index.html',
    './style.css',
    './logica.js',
    './script.js',
    './manifest.webmanifest',
    './icone.svg',
    './icone-192.png',
    './icone-512.png',
    './icone-maskable-512.png',
];

self.addEventListener('install', (evento) => {
    evento.waitUntil(
        caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (evento) => {
    evento.waitUntil(
        caches
            .keys()
            .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (evento) => {
    const pedido = evento.request;
    if (pedido.method !== 'GET' || new URL(pedido.url).origin !== self.location.origin) return;

    evento.respondWith(
        caches.open(VERSAO).then(async (cache) => {
            const emCache = await cache.match(pedido, { ignoreSearch: true });
            const rede = fetch(pedido)
                .then((resposta) => {
                    if (resposta && resposta.ok) cache.put(pedido, resposta.clone());
                    return resposta;
                })
                .catch(() => emCache);
            return emCache || rede;
        })
    );
});
