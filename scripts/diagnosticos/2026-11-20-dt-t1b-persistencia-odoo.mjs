/**
 * DT-T1b (20-nov-2026, OK de Xaviel) — ¿un Conteo físico aplicado en un almacén con Odoo SOBREVIVE al poll de Odoo?
 * Qué hace: como el usuario QA qa_guarda_almacen (PROD) aplica +1 de un artículo en un almacén Odoo sin stock
 *   (abrir→guardar→cerrar→aplicar, los mismos RPC que usa la app), vigila stock_por_bodega ~12 min y lo REVIERTE.
 * Por qué queda: evidencia para decidir si la app ofrece «Aplicar como conteo físico» en almacenes Odoo. Escribe en prod
 *   (regla 19: versionado ANTES de correr). Credenciales solo de .env.local / QA-USERS.local (gitignored), nada por chat.
 *
 *   node scripts/diagnosticos/2026-11-20-dt-t1b-persistencia-odoo.mjs [--minutos 12]
 */
import fs from 'node:fs';
import path from 'node:path';

const MIN = Number(process.argv[process.argv.indexOf('--minutos') + 1]) || 12;
const BODEGA_RX = 'LOSA de PARQUEO'; // Torre Bolívar: almacén Odoo sin stock
const root = path.resolve(import.meta.dirname, '../../..'); // dev2/
const dir = fs.existsSync(path.join(root, 'csd-app/.env.local')) ? path.join(root, 'csd-app') : path.resolve(import.meta.dirname, '../..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(dir, '.env.local'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const U = env.SUPABASE_URL_PROD, ANON = env.SUPABASE_ANON_KEY_PROD, SR = env.SUPABASE_SERVICE_ROLE_KEY_PROD;
if (!U || !ANON || !SR) { console.error('✗ faltan SUPABASE_*_PROD en .env.local'); process.exit(1); }

const qa = fs.readFileSync(path.join(dir, 'QA-USERS.local'), 'utf8');
const seccion = qa.slice(qa.indexOf('Entorno PROD'));
const pw = (seccion.match(/Contraseña[^`\n]*`([^`]+)`/) || [])[1];
if (!pw) { console.error('✗ no encontré la contraseña QA de prod en QA-USERS.local'); process.exit(1); }

const sr = { apikey: SR, Authorization: 'Bearer ' + SR, 'Accept-Profile': 'sgc' };
const get = async (p) => (await fetch(U + '/rest/v1/' + p, { headers: sr })).json();

const login = await (await fetch(U + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'qa_guarda_almacen@constructorasd.com', password: pw }),
})).json();
if (!login.access_token) { console.error('✗ login QA prod falló'); process.exit(1); }
const uh = { apikey: ANON, Authorization: 'Bearer ' + login.access_token, 'Content-Type': 'application/json', 'Content-Profile': 'sgc', 'Accept-Profile': 'sgc' };
const rpc = async (fn, args) => {
  const r = await fetch(U + '/rest/v1/rpc/' + fn, { method: 'POST', headers: uh, body: JSON.stringify(args) });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!r.ok) throw new Error(`${fn} ${r.status}: ${t.slice(0, 200)}`);
  return d;
};

if ((await rpc('puede_operar_conteo', {})) !== true) { console.error('✗ qa_guarda_almacen NO puede operar conteos (gate). No se escribió nada.'); process.exit(2); }

const [bod] = await get(`bodegas?select=id,nombre&nombre=ilike.*${encodeURIComponent(BODEGA_RX)}*`);
if (!bod) { console.error('✗ no encontré el almacén de prueba'); process.exit(1); }
const [corte] = await get(`odoo_corte_bodega?select=fuente_odoo,actualizada_en&bodega_id=eq.${bod.id}`);
if (!corte?.fuente_odoo) { console.error('✗ ese almacén NO es fuente_odoo; no sirve para la prueba. No se escribió nada.'); process.exit(2); }
const [art] = await get('articulos?select=id,nombre&activo=eq.true&order=nombre&limit=1');
const stock = async () => {
  const [s] = await get(`stock_por_bodega?select=cantidad,updated_at&bodega_id=eq.${bod.id}&articulo_id=eq.${art.id}`);
  return s ? { cantidad: Number(s.cantidad), at: s.updated_at } : { cantidad: 0, at: null };
};
const aplicar = async (cantidad, motivo) => {
  const id = await rpc('conteo_fisico_abrir', { p_bodega_id: bod.id, p_ciego: false });
  await rpc('conteo_fisico_guardar', { p_conteo_id: id, p_items: [{ articulo_id: art.id, cantidad_contada: cantidad }] });
  await rpc('conteo_fisico_cerrar', { p_conteo_id: id });
  return rpc('conteo_fisico_aplicar', { p_conteo_id: id, p_motivo: motivo });
};

const antes = await stock();
console.log(`• almacén: ${bod.nombre} (fuente_odoo=true) · artículo: ${art.nombre} · stock antes: ${antes.cantidad}`);
const objetivo = antes.cantidad + 1;
const linea = [];
let revertir = false;
try {
  console.log('• aplicando conteo físico →', objetivo, JSON.stringify(await aplicar(objetivo, 'PRUEBA DT-T1b persistencia Odoo (OK Xaviel 20-nov): se revierte al terminar')));
  revertir = true;
  const t0 = Date.now();
  for (let m = 0; m <= MIN; m++) {
    const s = await stock();
    linea.push({ min: m, cantidad: s.cantidad });
    console.log(`  min ${String(m).padStart(2)}: stock = ${s.cantidad}`);
    if (m < MIN) await new Promise((r) => setTimeout(r, Math.max(0, (m + 1) * 60_000 - (Date.now() - t0))));
  }
} finally {
  if (revertir) {
    const ahora = await stock();
    if (ahora.cantidad !== antes.cantidad) {
      console.log('• revirtiendo a', antes.cantidad, JSON.stringify(await aplicar(antes.cantidad, 'PRUEBA DT-T1b: reversión al valor original')));
    } else console.log('• ya estaba en el valor original (Odoo lo revirtió); no hace falta revertir.');
    console.log('• stock final:', (await stock()).cantidad);
  }
}
const revirtio = linea.find((x, i) => i > 0 && x.cantidad === antes.cantidad);
const persiste = linea.length && linea.every((x) => x.cantidad === objetivo);
console.log('\nVEREDICTO:', persiste ? `PERSISTE ${MIN} min (Odoo NO lo revirtió)` : revirtio ? `REVERTIDO por Odoo en el min ${revirtio.min}` : 'INCONCLUSO (valores mixtos): ' + JSON.stringify(linea));
