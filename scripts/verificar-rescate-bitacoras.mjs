// Detector de RESCATE de bitácoras atascadas (BI2/PROMPT-33 — criterio de éxito).
//
// Las 3 bitácoras del ingeniero (captura 20 y 25 de agosto) viven SOLO en su Android
// (IndexedDB por dispositivo) y no tienen rastro en el servidor. Cuando él actualice a
// 2.12.0 y reintente, cada una se INSERTA en sgc.bitacoras con `fecha` de agosto pero
// `created_at` de AHORA — ese desfase es la señal inequívoca de una bitácora rescatada.
//
// Este script lista esas bitácoras y CUENTA sus fotos en el bucket sgc-bitacora
// (foto_/restr_/dano_/voz_), para verificar "llegadas vs declaradas". Corre cuando
// quieras: `node scripts/verificar-rescate-bitacoras.mjs`
//
// Umbral: una bitácora es "rescatada" si su fecha es anterior a UMBRAL_CAPTURA y su
// created_at es posterior a UMBRAL_INSERCION (ajusta si cambia la ventana).
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const UMBRAL_CAPTURA = '2026-09-01'; // fecha de captura ANTERIOR a esto = vieja
const UMBRAL_INSERCION = '2026-09-03T20:00:00Z'; // insertada DESPUÉS de esto = tardía (post-release 2.12.0)

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
  if (error) return { total: 0, detalle: `(error listando: ${error.message})` };
  const slots = { foto: 0, restr: 0, dano: 0, voz: 0, otro: 0 };
  for (const f of data ?? []) {
    if (/^foto_/.test(f.name)) slots.foto++;
    else if (/^restr/.test(f.name)) slots.restr++;
    else if (/^dano/.test(f.name)) slots.dano++;
    else if (/^voz|^restraudio/.test(f.name)) slots.voz++;
    else slots.otro++;
  }
  const total = (data ?? []).length;
  return { total, detalle: `foto=${slots.foto} restr=${slots.restr} dano=${slots.dano} voz=${slots.voz}${slots.otro ? ` otro=${slots.otro}` : ''}` };
};

console.log('== Detector de rescate de bitácoras (PROMPT-33 BI2) ==\n');

// 1) señal temprana: la app 2.12.0 del ingeniero registró sus atascadas en telemetría.
const { data: atascadas } = await admin.from('outbox_atascados')
  .select('usuario_nombre,tipo_op,fotos_count,intentos,resuelto,ultima_vez')
  .eq('tipo_op', 'bitacora').order('ultima_vez', { ascending: false });
if (atascadas?.length) {
  console.log(`🟡 Telemetría: ${atascadas.length} bitácora(s) reportada(s) como atascada(s) por la app:`);
  for (const a of atascadas) console.log(`   - ${a.usuario_nombre} · ${a.fotos_count} fotos · ${a.intentos} intentos · resuelto=${a.resuelto} · ${a.ultima_vez?.slice(0, 10)}`);
  console.log('   (significa que su app ya está en 2.12.0 y reclasificó — el reintento es el siguiente paso)\n');
} else {
  console.log('⚪ Telemetría: 0 bitácoras atascadas registradas (su app aún no reportó / no está en 2.12.0).\n');
}

// 2) señal fuerte: bitácoras rescatadas (fecha vieja, insertadas ahora).
const { data: rescatadas, error } = await admin.from('bitacoras')
  .select('id,fecha,usuario_id,created_at,proyecto_id,es_prueba')
  .lt('fecha', UMBRAL_CAPTURA).gte('created_at', UMBRAL_INSERCION)
  .order('created_at', { ascending: false });
if (error) { console.error('error consultando bitacoras:', error.message); process.exit(1); }

if (!rescatadas?.length) {
  console.log('⚪ Ninguna bitácora rescatada aún (ninguna con fecha < ' + UMBRAL_CAPTURA + ' insertada tras el release).');
  console.log('   → El ingeniero todavía no ha reintentado, o aún no llegan al servidor.');
  process.exit(0);
}

console.log(`🟢 ${rescatadas.length} BITÁCORA(S) RESCATADA(S) detectada(s):\n`);
for (const b of rescatadas) {
  const nombre = await nombreUsuario(b.usuario_id);
  const { data: acts } = await admin.from('bitacora_actividades').select('id').eq('bitacora_id', b.id);
  const fotos = await contarFotos(b.id);
  console.log(`  • ${b.id}`);
  console.log(`    ingeniero: ${nombre}${b.es_prueba ? ' [PRUEBA]' : ''}`);
  console.log(`    captura: ${b.fecha}  →  entró al servidor: ${b.created_at?.slice(0, 16).replace('T', ' ')}`);
  console.log(`    actividades: ${acts?.length ?? 0}  ·  fotos en bucket: ${fotos.total} (${fotos.detalle})`);
  console.log('');
}
console.log('⚠️  Verifica fotos LLEGADAS vs DECLARADAS con el ingeniero: si faltan, NO descartar (BI7).');
