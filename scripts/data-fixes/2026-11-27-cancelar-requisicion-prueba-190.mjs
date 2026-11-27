// 2026-11-27 · Cancela la requisición de PRUEBA #190 (OBRA DEMO, nota «PRUEBA hotfix ignorar») creada en prod al verificar el hotfix 2.73.4.
// Qué hace: UPDATE sgc.solicitudes_material → estado='cancelada' SOLO si id/nota coinciden y sigue sin cancelar. Idempotente.
// Por qué queda: regla 19 — toda escritura en prod vive en un archivo versionado.
// Uso: node scripts/data-fixes/2026-11-27-cancelar-requisicion-prueba-190.mjs --env dev|prod [--yes]
import '../lib/load-env.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--env');
const env = i !== -1 ? argv[i + 1] : null;
if (env !== 'dev' && env !== 'prod') { console.error('🔴 falta --env dev|prod'); process.exit(1); }
if (env === 'prod' && !argv.includes('--yes')) { console.error('🔴 prod requiere --yes'); process.exit(1); }
const S = env.toUpperCase();
const url = process.env[`SUPABASE_URL_${S}`];
const key = process.env[`SUPABASE_SERVICE_ROLE_KEY_${S}`];
if (!url || !key) { console.error(`🔴 faltan SUPABASE_URL_${S}/SUPABASE_SERVICE_ROLE_KEY_${S}`); process.exit(1); }

const ID = '8c6b8317-f392-4bdd-9f29-1280a02a4747';
const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc', Prefer: 'return=representation' };
const q = `${url}/rest/v1/solicitudes_material?id=eq.${ID}&estado=neq.cancelada`;
const g = await fetch(`${url}/rest/v1/solicitudes_material?id=eq.${ID}&select=id,estado,notas`, { headers: h });
const fila = (await g.json())[0];
if (!fila) { console.log(`ℹ no existe en ${env}; nada que hacer`); process.exit(0); }
console.log('antes:', JSON.stringify(fila));
if (!/PRUEBA hotfix/i.test(fila.notas || '')) { console.error('🔴 la nota no es la de la prueba; no se toca'); process.exit(1); }
const r = await fetch(q, { method: 'PATCH', headers: h, body: JSON.stringify({ estado: 'cancelada', cancelada_motivo: 'PRUEBA del hotfix 2.73.4 (no es una requisición real)', cerrada_en: new Date().toISOString() }) });
console.log(r.ok ? `✓ ${r.status} ${(await r.text()).slice(0, 160)}` : `🔴 ${r.status} ${await r.text()}`);
process.exit(r.ok ? 0 : 1);
