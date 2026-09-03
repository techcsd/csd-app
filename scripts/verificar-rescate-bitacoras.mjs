// Detector de campo (PROMPT-33 BI) — vigila 3 señales del criterio de éxito:
//   1) RESCATE: las 3 bitácoras del ingeniero (captura 20/25 ago) que viven SOLO en su
//      Android. Al reintentar en 2.12.0, cada una se INSERTA en sgc.bitacoras con `fecha`
//      de agosto pero `created_at` de AHORA — ese desfase es la señal inequívoca. Se
//      cuentan sus fotos en el bucket sgc-bitacora (llegadas vs actividades).
//   2) TELEMETRÍA: su app 2.12.0 registra las atascadas en sgc.outbox_atascados.
//   3) WATCHDOG: filas nuevas con firma de watchdog en sgc.app_error_reports DESPUÉS del
//      release — no debería aparecer ninguna (BI4 dejó de emitir + filtro server-side).
//      Si aparece una de un cliente 2.12.0 = regresión; de un cliente viejo = fuga del filtro.
//
// Corre cuando quieras: `node scripts/verificar-rescate-bitacoras.mjs`
// Imprime al final `VERDICTO: SILENCIO` o `VERDICTO: ALERTA — <motivos>`.
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const UMBRAL_CAPTURA = '2026-09-01'; // fecha de captura ANTERIOR a esto = vieja
const UMBRAL_RELEASE = '2026-09-03T20:00:00Z'; // insertado/reportado DESPUÉS = post-release 2.12.0

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'sgc' }, auth: { persistSession: false } });

const nombreUsuario = async (id) => {
  if (!id) return '(sin usuario)';
  const { data } = await admin.from('usuarios').select('nombre').eq('id', id).maybeSingle();
  return data?.nombre ?? id.slice(0, 8);
};
const contarFotos = async (bitacoraId) => {
  const { data, error } = await admin.storage.from('sgc-bitacora').list(bitacoraId, { limit: 200 });
  if (error) return { total: 0, detalle: `(error: ${error.message})` };
  const s = { foto: 0, restr: 0, dano: 0, voz: 0, otro: 0 };
  for (const f of data ?? []) {
    if (/^foto_/.test(f.name)) s.foto++;
    else if (/^restr/.test(f.name)) s.restr++;
    else if (/^dano/.test(f.name)) s.dano++;
    else if (/^voz|^restraudio/.test(f.name)) s.voz++;
    else s.otro++;
  }
  return { total: (data ?? []).length, detalle: `foto=${s.foto} restr=${s.restr} dano=${s.dano} voz=${s.voz}${s.otro ? ` otro=${s.otro}` : ''}` };
};

console.log('== Detector de campo (PROMPT-33 BI) ==\n');
const motivos = [];

// ── 1) RESCATE ───────────────────────────────────────────────────────────────
const { data: rescatadas, error: eB } = await admin.from('bitacoras')
  .select('id,fecha,usuario_id,created_at,es_prueba')
  .lt('fecha', UMBRAL_CAPTURA).gte('created_at', UMBRAL_RELEASE)
  .order('created_at', { ascending: false });
if (eB) { console.error('error bitacoras:', eB.message); process.exit(1); }
if (rescatadas?.length) {
  console.log(`🟢 ${rescatadas.length} BITÁCORA(S) RESCATADA(S):`);
  for (const b of rescatadas) {
    const nombre = await nombreUsuario(b.usuario_id);
    const { data: acts } = await admin.from('bitacora_actividades').select('id').eq('bitacora_id', b.id);
    const fotos = await contarFotos(b.id);
    console.log(`   • ${b.id} — ${nombre}${b.es_prueba ? ' [PRUEBA]' : ''}`);
    console.log(`     captura ${b.fecha} → entró ${b.created_at?.slice(0, 16).replace('T', ' ')} · actividades ${acts?.length ?? 0} · fotos ${fotos.total} (${fotos.detalle})`);
  }
  motivos.push(`${rescatadas.length} bitácora(s) rescatada(s) — verificar fotos vs declaradas, NO descartar`);
} else {
  console.log('⚪ Rescate: ninguna bitácora rescatada aún.');
}

// ── 2) TELEMETRÍA ─────────────────────────────────────────────────────────────
const { data: atascadas } = await admin.from('outbox_atascados')
  .select('usuario_nombre,tipo_op,fotos_count,intentos,resuelto,ultima_vez')
  .eq('tipo_op', 'bitacora').order('ultima_vez', { ascending: false });
if (atascadas?.length) {
  const noRes = atascadas.filter((a) => !a.resuelto);
  console.log(`\n🟡 Telemetría: ${atascadas.length} bitácora(s) atascada(s) reportada(s) (${noRes.length} sin resolver):`);
  for (const a of atascadas) console.log(`   - ${a.usuario_nombre} · ${a.fotos_count} fotos · ${a.intentos} intentos · resuelto=${a.resuelto} · ${a.ultima_vez?.slice(0, 10)}`);
  if (noRes.length) motivos.push(`${noRes.length} atascada(s) en telemetría (su app ya está en 2.12.0)`);
} else {
  console.log('\n⚪ Telemetría: 0 bitácoras atascadas registradas.');
}

// ── 3) WATCHDOG ───────────────────────────────────────────────────────────────
const { data: wd } = await admin.from('app_error_reports')
  .select('app_version,platform,message,created_at')
  .ilike('message', '%watchdog%').gte('created_at', UMBRAL_RELEASE)
  .order('created_at', { ascending: false }).limit(30);
if (wd?.length) {
  const porVer = {};
  for (const r of wd) porVer[r.app_version || '?'] = (porVer[r.app_version || '?'] || 0) + 1;
  console.log(`\n🔴 Watchdog: ${wd.length} reporte(s) post-release en el panel — NO debería haber ninguno:`);
  console.log('   por versión:', JSON.stringify(porVer));
  console.log('   ejemplo:', wd[0].message?.slice(0, 80));
  const de212 = wd.filter((r) => (r.app_version || '').startsWith('2.12'));
  if (de212.length) motivos.push(`🔴 ${de212.length} reporte(s) de watchdog de clientes 2.12.0 — REGRESIÓN (el cliente no debería emitir)`);
  else motivos.push(`${wd.length} reporte(s) de watchdog de clientes viejos post-release — fuga del filtro server-side (revisar la firma)`);
} else {
  console.log('\n⚪ Watchdog: 0 reportes en el panel post-release (fix OK).');
}

// ── VEREDICTO ─────────────────────────────────────────────────────────────────
console.log('');
if (motivos.length) {
  console.log('VERDICTO: ALERTA — ' + motivos.join(' · '));
  process.exit(0);
}
console.log('VERDICTO: SILENCIO (nada que reportar).');
