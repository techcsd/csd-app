// scripts/lib/publicar-version.mjs — marca una versión móvil como la VIGENTE (publicada=true).
//
// Por qué existe: `release-apk.mjs` subía el APK y REGISTRABA la versión en `app_versiones`, pero la app
// consulta `version_publicada('movil')`, que solo mira la fila `publicada=true`. Sin este paso los teléfonos
// seguían recibiendo la versión anterior (2.71.6 y 2.71.7 quedaron subidas y el actualizador instalaba 2.71.5).
// Antes se hacía a mano con un data-fix por versión (scripts/data-fixes/*-publicar-*.mjs); ahora lo hace el release.
//
// Qué hace (plataforma 'movil' por defecto), idempotente:
//   1) comprueba que la versión exista en app_versiones y tenga apk_url,
//   2) despublica la que estaba publicada (publicada=true → false),
//   3) publica `version` (publicada=true, publicada_por=Tecnología, publicada_at=now()),
//   4) NO toca `minima` (no se fuerza actualización).
// En prod exige una línea OK válida en qa/release-<version>.md (misma regla que los data-fixes anteriores).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { okLineaValida } from './ok-linea.mjs';

const TECNOLOGIA_EMAIL = 'tecnologia@constructorasd.com';
const ROOT = join(import.meta.dirname, '..', '..');

export async function publicarVersion({ entorno, url, serviceKey, version, plataforma = 'movil', log = console.log }) {
  if (!url || !serviceKey) throw new Error('Faltan la URL y la service key del entorno.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Versión inválida: ${version}`);

  if (entorno === 'prod') {
    let md = '';
    try { md = readFileSync(join(ROOT, 'qa', `release-${version}.md`), 'utf8'); } catch { /* sin archivo = sin OK */ }
    if (!okLineaValida(md)) {
      throw new Error(`qa/release-${version}.md no tiene una línea OK válida (con fecha, sin negaciones): no se publica en prod.`);
    }
  }

  const H = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc', 'Content-Type': 'application/json' };
  const api = (path, init = {}) => fetch(url.replace(/\/$/, '') + '/rest/v1/' + path, { ...init, headers: { ...H, ...(init.headers || {}) } });

  const filas = await (await api(`app_versiones?select=id,apk_url,publicada&plataforma=eq.${plataforma}&version=eq.${encodeURIComponent(version)}`)).json();
  if (!Array.isArray(filas) || !filas.length) throw new Error(`${version} (${plataforma}) no existe en app_versiones de ${entorno}.`);
  if (!filas[0].apk_url) throw new Error(`${version} no tiene apk_url: no se puede publicar una versión sin APK.`);

  const u = await (await api(`usuarios?select=id&email=ilike.${encodeURIComponent(TECNOLOGIA_EMAIL)}`)).json();
  const autorId = Array.isArray(u) && u[0]?.id;
  if (!autorId) throw new Error('No se encontró el usuario de Tecnología para publicada_por.');

  const des = await api(`app_versiones?plataforma=eq.${plataforma}&publicada=eq.true&version=neq.${encodeURIComponent(version)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ publicada: false }),
  });
  const desRows = await des.json();
  log(`• despublicadas: ${Array.isArray(desRows) ? desRows.map((r) => r.version).join(', ') || '(ninguna)' : des.status}`);

  const pub = await api(`app_versiones?plataforma=eq.${plataforma}&version=eq.${encodeURIComponent(version)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ publicada: true, publicada_por: autorId, publicada_at: new Date().toISOString() }),
  });
  if (!pub.ok) throw new Error(`No se pudo publicar ${version}: ${pub.status} ${await pub.text()}`);

  // Verificación: lo que la app va a leer.
  const vp = await api('rpc/version_publicada', { method: 'POST', body: JSON.stringify({ p_plataforma: plataforma }) });
  const vigente = vp.ok ? (await vp.json())?.version_publicada : null;
  if (vigente !== version) throw new Error(`Publicada, pero version_publicada('${plataforma}') devuelve ${vigente ?? '?'} y no ${version}.`);
  log(`✓ publicada ${version} (${plataforma}) en ${entorno}: la app ahora ofrece esta versión (version_publicada = ${vigente}).`);
  return { version, entorno, plataforma };
}
