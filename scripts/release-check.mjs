// scripts/release-check.mjs — CP5 (docs/STAGING.md) — gate gemelo del de SGC, adaptado:
// el hijo NO aplica sus propias migraciones (sql-para-sgc/ las aplica el padre, regla 19),
// así que no hay ledger ni evals de Compa que auditar aquí — esos los audita el
// release-check DEL PADRE sobre sus propios archivos. Lo que SÍ es responsabilidad de
// este repo y nada más lo cerraba antes: que alguien probó de verdad la actualización
// in-app desde la versión anterior en un teléfono real antes de publicar (regla CL4),
// con un registro humano — no solo "me acuerdo que lo probé".
//
//   node scripts/release-check.mjs --version 2.52.0
//   node scripts/release-check.mjs --version 2.52.0 --skip-build   (SOLO debugging local — NUNCA para un release real)
//
// 4 checks, cada uno imprime PASS/FAIL (nunca un salto silencioso):
//   1. `dev` tuvo tiempo de "respirar" (≥24h desde el último commit) O hay un OK
//      explícito de Xaviel en qa/release-<version>.md (línea que empieza con "OK:" o
//      "**OK de Xaviel**").
//   2. qa/release-<version>.md existe, no es un stub, y documenta la prueba de
//      actualización in-app (CL4): exige una línea "Versión de origen:" (la versión de
//      prod anterior desde la que se probó actualizar) además del resto del registro.
//   3. Los 3 sitios de versión (environment.prod.ts, environment.dev.ts, build.gradle)
//      están alineados entre sí Y con --version.
//   4. `npm run build` (incluye todo el prebuild: guards + i18n + envío-único) y
//      `npm run test:canal` salen en verde. El check más lento → va último.
//      `--skip-build` lo salta (debugging local de este script únicamente).
//
// Exit code: 1 si algún check es FAIL. 0 si todo es PASS.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const VERSION = flag('--version');
if (!VERSION || typeof VERSION !== 'string') {
  console.error('🔴 falta --version X.Y.Z');
  console.error('Uso: node scripts/release-check.mjs --version X.Y.Z [--skip-build]');
  process.exit(1);
}
const SKIP_BUILD = argv.includes('--skip-build');
const RELEASE_PATH = join(ROOT, 'qa', `release-${VERSION}.md`);

const resultados = []; // { id, titulo, estado: 'PASS'|'FAIL', detalle: string[] }
function reportar(id, titulo, estado, detalle = []) {
  resultados.push({ id, titulo, estado, detalle: Array.isArray(detalle) ? detalle : [detalle] });
  const icono = estado === 'PASS' ? '✅' : '🔴';
  console.log(`\n${icono} [${id}] ${titulo} — ${estado}`);
  for (const l of resultados[resultados.length - 1].detalle) console.log(`     ${l}`);
}

function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

// ── Check 1 — dev respiró, o hay OK explícito ────────────────────────────────
function check1() {
  const ts = git('log -1 --format=%ct dev') ?? git('log -1 --format=%ct origin/dev');
  const okRegex = /^(OK:|\*\*OK de Xaviel\*\*)/im;
  let okMarcado = false;
  if (existsSync(RELEASE_PATH)) {
    try { okMarcado = okRegex.test(readFileSync(RELEASE_PATH, 'utf8')); } catch { /* noop */ }
  }

  if (!ts) {
    if (okMarcado) return reportar('breathe', "Dev tuvo tiempo de respirar / OK explícito", 'PASS', [`no se pudo leer la fecha del último commit de 'dev', pero hay un OK explícito en ${RELEASE_PATH}.`]);
    return reportar('breathe', "Dev tuvo tiempo de respirar / OK explícito", 'FAIL', [
      `no se pudo determinar la fecha del último commit de 'dev' (ni local ni origin/dev) y no hay OK explícito en qa/release-${VERSION}.md.`,
      'Convención del OK: una línea que empiece con "OK:" o "**OK de Xaviel**" en ese archivo.',
    ]);
  }
  const horas = (Date.now() / 1000 - Number(ts)) / 3600;
  if (horas >= 24) return reportar('breathe', "Dev tuvo tiempo de respirar / OK explícito", 'PASS', [`último commit de 'dev' hace ${horas.toFixed(1)}h (≥24h).`]);
  if (okMarcado) return reportar('breathe', "Dev tuvo tiempo de respirar / OK explícito", 'PASS', [`último commit de 'dev' hace solo ${horas.toFixed(1)}h, pero hay OK explícito en qa/release-${VERSION}.md.`]);
  return reportar('breathe', "Dev tuvo tiempo de respirar / OK explícito", 'FAIL', [
    `último commit de 'dev' hace solo ${horas.toFixed(1)}h (<24h) y no hay OK explícito.`,
    `Esperar, o agregar una línea "OK: <quién, qué probó, fecha>" en qa/release-${VERSION}.md.`,
  ]);
}

// ── Check 2 — registro humano de prueba de actualización (CL4) ──────────────
function check2() {
  if (!existsSync(RELEASE_PATH)) {
    return reportar('registro', 'Registro de prueba qa/release-<version>.md (CL4: actualización in-app)', 'FAIL', [
      `falta ${RELEASE_PATH}. Crea el archivo con algo como:`,
      '',
      `  # Release ${VERSION}`,
      '  - Equipo/dispositivo: <Samsung Xaviel | iPhone Raykler | …>',
      `  - Versión de origen: <X.Y.Z anterior — la actualización in-app se probó DESDE esta versión>`,
      '  - Qué se probó: <actualización in-app + flujos ejercitados>',
      '  - Resultado: OK | FALLA (detalle)',
      '  - Fecha: <YYYY-MM-DD>',
      '',
      'Si Xaviel ya dio el visto bueno sin esperar 24h, agrega además una línea "OK: <detalle>" (ver check 1).',
    ]);
  }
  const contenido = readFileSync(RELEASE_PATH, 'utf8');
  const lineas = contenido.split('\n').map((l) => l.trim()).filter(Boolean);
  if (contenido.trim().length < 80 || lineas.length < 3) {
    return reportar('registro', 'Registro de prueba qa/release-<version>.md (CL4: actualización in-app)', 'FAIL', [`${RELEASE_PATH} existe pero parece un stub (${contenido.trim().length} caracteres, ${lineas.length} línea(s) no vacías) — completa el registro real de prueba.`]);
  }
  if (!/versi[oó]n de origen/i.test(contenido)) {
    return reportar('registro', 'Registro de prueba qa/release-<version>.md (CL4: actualización in-app)', 'FAIL', [
      `${RELEASE_PATH} no documenta la "Versión de origen" (CL4 exige probar la actualización in-app DESDE la versión de prod anterior, no una instalación limpia).`,
      'Agrega una línea "Versión de origen: X.Y.Z".',
    ]);
  }
  return reportar('registro', 'Registro de prueba qa/release-<version>.md (CL4: actualización in-app)', 'PASS', [`${RELEASE_PATH} (${lineas.length} líneas), documenta versión de origen.`]);
}

// ── Check 3 — los 3 sitios de versión alineados entre sí y con --version ────
function check3() {
  const leer = (path, re) => {
    const full = join(ROOT, path);
    if (!existsSync(full)) return null;
    const m = readFileSync(full, 'utf8').match(re);
    return m ? m[1] : null;
  };
  const sitios = {
    'src/environments/environment.prod.ts': leer('src/environments/environment.prod.ts', /version:\s*'([^']+)'/),
    'src/environments/environment.dev.ts': leer('src/environments/environment.dev.ts', /version:\s*'([^']+)'/),
    'android/app/build.gradle': leer('android/app/build.gradle', /appVersionName\s*=\s*"([^"]+)"/),
  };
  const faltantes = Object.entries(sitios).filter(([, v]) => !v).map(([k]) => k);
  if (faltantes.length) {
    return reportar('version', 'Los 3 sitios de versión alineados', 'FAIL', [`no pude leer la versión en: ${faltantes.join(', ')}`]);
  }
  const desalineados = Object.entries(sitios).filter(([, v]) => v !== VERSION);
  if (desalineados.length) {
    return reportar('version', 'Los 3 sitios de versión alineados', 'FAIL', [
      `esperada --version ${VERSION}, pero:`,
      ...Object.entries(sitios).map(([k, v]) => `- ${k}: ${v}`),
    ]);
  }
  return reportar('version', 'Los 3 sitios de versión alineados', 'PASS', [`los 3 sitios en ${VERSION}: ${Object.keys(sitios).join(', ')}.`]);
}

// ── Check 4 — build + test:canal (último por ser el más lento) ──────────────
function correr(cmd) {
  try {
    const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', maxBuffer: 1024 * 1024 * 50, timeout: 10 * 60 * 1000 });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`.slice(-4000) };
  }
}
function check4() {
  if (SKIP_BUILD) {
    return reportar('build', 'Build (guards+i18n+envío-único) + test:canal', 'FAIL', ['--skip-build: SOLO para debugging local de release-check.mjs — nunca uses este flag para un release real (reporta FAIL a propósito para que no se cuele en CI/memoria).']);
  }
  console.log('\n   ⏳ npm run build (incluye prebuild: todos los guards + i18n + envío-único)…');
  const build = correr('npm run build');
  if (!build.ok) {
    return reportar('build', 'Build (guards+i18n+envío-único) + test:canal', 'FAIL', ['`npm run build` falló:', ...build.out.split('\n').slice(-30)]);
  }
  console.log('   ⏳ npm run test:canal…');
  const test = correr('npm run test:canal');
  if (!test.ok) {
    return reportar('build', 'Build (guards+i18n+envío-único) + test:canal', 'FAIL', ['`npm run build` OK.', '`npm run test:canal` falló:', ...test.out.split('\n').slice(-30)]);
  }
  return reportar('build', 'Build (guards+i18n+envío-único) + test:canal', 'PASS', ['`npm run build` OK.', '`npm run test:canal` OK.']);
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`▶ release-check — versión ${VERSION}\n`);
console.log('Antes de todo `apk:publish --env prod` y de todo PR `dev → main` (CLAUDE.md, regla 18/CL4).');

check1();
check2();
check3();
check4();

console.log('\n── Resumen ──');
for (const r of resultados) {
  const icono = r.estado === 'PASS' ? '✅' : '🔴';
  console.log(`  ${icono} ${r.estado.padEnd(4)} ${r.titulo}`);
}
const fallos = resultados.filter((r) => r.estado === 'FAIL');
if (fallos.length) {
  console.log(`\n🔴 ${fallos.length}/${resultados.length} check(s) en FAIL — NO promuevas dev → main ni publiques en prod hasta resolverlos.`);
  process.exit(1);
}
console.log(`\n✅ Todos los checks en PASS (${resultados.length} total) — release-check OK para ${VERSION}.`);
