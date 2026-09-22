// build-env.mjs — BU1 F1 (hijo) — elige la configuración de build por entorno y
// construye la PWA. Copiado del padre (misma resolución de entorno); adaptado a la
// app: no registra versión web (la app registra por release-apk / autoRegistrar).
//
//   Vercel:  VERCEL_ENV=production → prod ;  preview → dev
//   Local:   SGC_ENV=dev|prod   o   --env dev|prod
//
// Copia environment.<target>.ts → environment.ts (para que la resolución de módulos
// funcione en CI sin .env.local — Vercel no tiene .env.local) y corre
// `ng build --configuration <dev|production>`.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// BU1 F1.1/F1.2 — la PWA dev tiene IDENTIDAD propia para que iPhone instale DOS
// PWAs (prod y dev) sin pisarse: distinto `name`/título/favicon/iconos. El dominio
// distinto (app-dev.) ya la hace otra app; esto lo hace obvio a la vista. Se parchea
// el dist tras el build (los archivos versionados quedan intactos = los de prod).
function patchDistForDev() {
  const DIST = 'dist/csd-app/browser';
  // manifest
  const mf = `${DIST}/manifest.webmanifest`;
  if (existsSync(mf)) {
    const m = JSON.parse(readFileSync(mf, 'utf8'));
    m.name = 'CSD App DEV — Constructora SD';
    m.short_name = 'CSD App DEV';
    m.theme_color = '#f97316';
    m.background_color = '#f97316';
    if (Array.isArray(m.icons)) m.icons = m.icons.map((i) => ({ ...i, src: i.src.replace('icons/', 'icons-dev/') }));
    writeFileSync(mf, JSON.stringify(m, null, 2), 'utf8');
    console.log('▶ dev: manifest → "CSD App DEV" (icons-dev)');
  }
  // index.html + index.csr.html
  for (const f of ['index.html', 'index.csr.html']) {
    const p = `${DIST}/${f}`;
    if (!existsSync(p)) continue;
    let html = readFileSync(p, 'utf8');
    html = html
      .replace(/<title>CSD App<\/title>/, '<title>[DEV] CSD App</title>')
      .replace(/content="CSD App"/g, 'content="CSD App DEV"')
      .replace(/href="favicon\.png"/g, 'href="favicon-dev.png"')
      .replace(/href="icons\/icon-192x192\.png"/g, 'href="icons-dev/icon-192x192.png"')
      .replace(/content="#1e3a5f"/g, 'content="#f97316"');
    writeFileSync(p, html, 'utf8');
  }
  console.log('▶ dev: index → título [DEV] + favicon/iconos dev');
}

const argEnv = (() => { const i = process.argv.indexOf('--env'); return i !== -1 ? process.argv[i + 1] : null; })();
const vercel = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development'
const sgc = process.env.SGC_ENV;       // override local
let target = 'prod';
if (argEnv === 'dev' || argEnv === 'prod') target = argEnv;
else if (sgc === 'dev' || sgc === 'prod') target = sgc;
else if (vercel === 'preview') target = 'dev';
else if (vercel === 'production') target = 'prod';

const src = `src/environments/environment.${target}.ts`;
if (!existsSync(src)) { console.error(`no existe ${src}`); process.exit(1); }
copyFileSync(src, 'src/environments/environment.ts');
const config = target === 'dev' ? 'dev' : 'production';
console.log(`▶ build ${target} (ng build --configuration ${config})`);
// Vercel llama a este script como buildCommand (salta el ciclo npm de prebuild),
// así que corremos aquí los guards (prebuild) → build.
execSync('npm run prebuild', { stdio: 'inherit' });
execSync(`npx ng build --configuration ${config}`, { stdio: 'inherit' });
if (target === 'dev') patchDistForDev();
