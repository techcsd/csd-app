/**
 * BU1 F0 — genera un archivo de environment del entorno pedido leyendo
 * SUPABASE_URL_<ENV>/SUPABASE_ANON_KEY_<ENV> de .env.local. La versión se toma de
 * environment.prod.ts (fuente única). Cumple la regla 18: **ng serve local nunca
 * habla con prod por defecto** — `npm start` corre `--ensure` (crea el placeholder
 * "Sin proyecto configurado" si falta environment.ts, nunca pisa uno existente) y
 * el desarrollador apunta a dev con `npm run env:dev`.
 *
 *   node scripts/gen-environment.mjs --env dev           # → environment.ts (serve local, dev)
 *   node scripts/gen-environment.mjs --env prod          # → environment.ts (serve local, prod)
 *   node scripts/gen-environment.mjs --ensure            # crea environment.ts placeholder si falta
 *   # (uso interno) regenerar los committed:
 *   node scripts/gen-environment.mjs --env dev  --target src/environments/environment.dev.ts  --production
 *   node scripts/gen-environment.mjs --env prod --target src/environments/environment.prod.ts --production
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

function loadEnvLocal() {
  const env = {};
  if (!existsSync('.env.local')) return env;
  for (const raw of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

function version() {
  // Fuente única de la versión: environment.prod.ts (alineada con build.gradle +
  // release-apk.mjs por el guard verify-dev-strings/la regla Y1).
  try {
    const m = readFileSync('src/environments/environment.prod.ts', 'utf8').match(/version:\s*'([^']+)'/);
    if (m) return m[1];
  } catch { /* fallthrough */ }
  return '0.0.0';
}

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? undefined : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const TARGET = typeof flag('--target') === 'string' ? flag('--target') : 'src/environments/environment.ts';

const APP_URL = { dev: 'https://app-dev.sgcconstructorasd.com', prod: 'https://app.sgcconstructorasd.com' };
const V = version();

function render({ production, entorno, url, anon }) {
  return (
    '// GENERADO por scripts/gen-environment.mjs — no editar a mano.\n' +
    `// entorno: ${entorno}. Regla 18: ng serve local jamás apunta a prod por defecto.\n` +
    'export const environment = {\n' +
    `  production: ${production},\n` +
    `  entorno: '${entorno}' as 'dev' | 'prod',\n` +
    `  version: '${V}',\n` +
    `  appUrl: '${APP_URL[entorno]}',\n` +
    `  supabaseUrl: '${url}',\n` +
    `  supabaseAnonKey: '${anon}',\n` +
    '};\n'
  );
}

// --ensure: crea SOLO si falta (placeholder vacío → pantalla "Sin proyecto configurado").
if (flag('--ensure')) {
  if (existsSync(TARGET)) { console.log(`✓ ${TARGET} ya existe (--ensure no lo toca).`); process.exit(0); }
  writeFileSync(TARGET, render({ production: false, entorno: 'dev', url: '', anon: '' }), 'utf8');
  console.log(`✓ ${TARGET} creado como placeholder (Sin proyecto configurado). Corre \`npm run env:dev\`.`);
  process.exit(0);
}

const entorno = flag('--env');
if (entorno !== 'dev' && entorno !== 'prod') {
  console.error('Uso: node scripts/gen-environment.mjs --env dev|prod   (o --ensure)');
  process.exit(1);
}

const env = loadEnvLocal();
const SUF = entorno.toUpperCase();
const url = env[`SUPABASE_URL_${SUF}`] || '';
const anon = env[`SUPABASE_ANON_KEY_${SUF}`] || '';
if (!url || !anon) {
  console.error(`✗ Faltan SUPABASE_URL_${SUF} / SUPABASE_ANON_KEY_${SUF} en .env.local.`);
  process.exit(1);
}
// --production: para regenerar los committed environment.<env>.ts (build config).
// Sin él: environment.ts de serve local (production:false).
const production = !!flag('--production');
writeFileSync(TARGET, render({ production, entorno, url, anon }), 'utf8');
console.log(`✓ ${TARGET} → entorno ${entorno} (${url}), production:${production}, v${V}.`);
