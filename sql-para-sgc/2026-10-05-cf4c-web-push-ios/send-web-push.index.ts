// ============================================================================
// CF4c — Edge function `send-web-push` (para el PADRE/SGC).
// Copiar a: supabase/functions/send-web-push/index.ts  y desplegar (dev y prod).
//
// Envía Web Push REAL (VAPID, cifrado aes128gcm) a las suscripciones web guardadas
// en sgc.device_tokens (p256dh NOT NULL) — iPhone/PWA (web.push.apple.com) y cualquier
// navegador. Lo dispara sgc.send_push (pg_net) con x-sync-secret, igual que send-push.
//
// config.toml:  [functions.send-web-push]  verify_jwt = false
// Secretos (poner con `supabase secrets set ... --project-ref <ref>` en dev y prod):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:tecnologia@constructorasd.com),
//   INFRA_SYNC_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// El payload sigue el formato que espera el service worker de Angular (ngsw):
//   { notification: { title, body, data } }  → ngsw pinta la notificación y expone
//   `data` en el tap (SwPush.notificationClicks del cliente).
//
// Nota de runtime: usa `npm:web-push`. Si el runtime de Supabase diera problemas con
// node-crypto, la alternativa Deno-native es `jsr:@negrel/webpush` (misma lógica VAPID).
// ============================================================================
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    // Auth interna: mismo secreto compartido que send-push.
    const secret = req.headers.get('x-sync-secret') ?? '';
    if (!secret || secret !== (Deno.env.get('INFRA_SYNC_SECRET') ?? '')) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
    const priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
    const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:tecnologia@constructorasd.com';
    if (!pub || !priv) return json({ ok: false, reason: 'vapid_apagado' }, 200);
    webpush.setVapidDetails(subject, pub, priv);

    const { user_ids, titulo, cuerpo, data } = await req.json();
    if (!Array.isArray(user_ids) || user_ids.length === 0) return json({ ok: true, sent: 0 }, 200);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'sgc' } },
    );

    // Solo suscripciones WEB (p256dh NOT NULL); las FCM/Android las manda send-push.
    const { data: subs, error } = await supabase
      .from('device_tokens')
      .select('token, p256dh, auth, usuario_id')
      .eq('activo', true)
      .not('p256dh', 'is', null)
      .in('usuario_id', user_ids);
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!subs || subs.length === 0) return json({ ok: true, sent: 0 }, 200);

    // ngsw espera { notification: { title, body, data } }.
    const payload = JSON.stringify({
      notification: {
        title: titulo ?? 'SGC',
        body: cuerpo ?? '',
        data: data ?? {},
        // vibrate/renotify ayudan en algunos navegadores; iOS ignora extras.
        requireInteraction: false,
      },
    });

    let sent = 0, failed = 0;
    const dead: string[] = [];
    await Promise.all(
      subs.map(async (s: { token: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.token, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 3600, urgency: 'high' },
          );
          sent++;
        } catch (e) {
          failed++;
          const code = (e as { statusCode?: number }).statusCode;
          // 404/410 = suscripción caducada → desactivar (limpieza, igual que send-push).
          if (code === 404 || code === 410) dead.push(s.token);
        }
      }),
    );

    if (dead.length) {
      await supabase.from('device_tokens').update({ activo: false }).in('token', dead);
    }
    return json({ ok: true, sent, failed, dead: dead.length }, 200);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
