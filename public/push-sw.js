// CO10/CO17 — capa propia de Web Push sobre el service worker de Angular.
//
// Por qué existe: `ngsw-worker.js` (Angular) SÍ sabe manejar `push`/`notificationclick`,
// pero SOLO si el payload llega como `{ notification: { title, body, ... } }`. El edge
// `send-push` del padre (SGC) manda un payload PLANO `{ title, body, url }` (ver
// `SGC/supabase/functions/send-push/index.ts`), que `ngsw-worker.js` ignora en
// silencio: la suscripción queda guardada y "activa", pero NUNCA se ve una
// notificación con la app cerrada. Esta capa pinta la notificación ella misma para
// ese formato plano, y deja que `ngsw-worker.js` siga haciendo TODO lo demás
// (caché, `fetch`, actualización de versión) sin tocarlo.
//
// `importScripts` carga `ngsw-worker.js` en este mismo scope: sus listeners de
// 'install'/'activate'/'fetch'/'message' quedan intactos; los de 'push'/
// 'notificationclick' de abajo se SUMAN (un Service Worker admite varios
// listeners para el mismo evento).
importScripts('./ngsw-worker.js');

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    return; // payload no-JSON (no debería pasar) — no reventar el SW.
  }
  // Si el payload YA viene en el formato que ngsw-worker.js entiende
  // (`{notification:{...}}`), lo deja pasar: ngsw ya lo pintó, no duplicar.
  if (data && data.notification) return;

  const title = data.title || 'CSD App';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  // Solo las notificaciones que ESTA capa creó traen `event.notification.data.url`
  // (las que ngsw-worker.js pinta se resuelven con su propio handler, que sigue activo).
  const url = event.notification && event.notification.data && event.notification.data.url;
  if (!url) return;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const abierta = lista.find((c) => 'focus' in c);
      if (abierta) {
        if ('navigate' in abierta) abierta.navigate(url).catch(() => {});
        return abierta.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
