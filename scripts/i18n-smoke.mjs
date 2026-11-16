/**
 * DP-13d — smoke de idioma (Playwright). Abre la app en `en` y `ht`, recorre rutas y FALLA si:
 *   (a) `<html lang>` no coincide con el idioma, o
 *   (b) `I18nService.t()` registró una clave sin traducir (`[i18n] sin traducción`, solo dev).
 * Rutas públicas (sin sesión): login, recuperar contraseña. Si hay credenciales QA de DEV
 * (CSD_QA_EMAIL + CSD_QA_PASSWORD, y opcional CSD_QA_PIN de 6 dígitos para el PIN de la app)
 * también recorre las rutas autenticadas de RUTAS_AUTH.
 *
 * USO:  npm run env:dev && npm start   (otra terminal)  →  npm run i18n:smoke
 * Playwright no es dependencia del repo: define PLAYWRIGHT_PATH (carpeta de @playwright/test,
 * p. ej. la del repo SGC) o instálalo con `npm i -D @playwright/test`.
 * `--shots <dir>` guarda capturas 390 px (claro) de cada ruta/idioma.
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
function cargarPlaywright() {
  const rutas = [process.env.PLAYWRIGHT_PATH, '@playwright/test'].filter(Boolean);
  for (const r of rutas) {
    try { return require(r); } catch { /* siguiente */ }
  }
  console.error('✗ i18n-smoke: no encuentro @playwright/test (define PLAYWRIGHT_PATH o instálalo).');
  process.exit(2);
}
const { chromium } = cargarPlaywright();

const BASE = process.env.CSD_QA_BASE || 'http://localhost:4200';
const shotsIdx = process.argv.indexOf('--shots');
const SHOTS = shotsIdx >= 0 ? process.argv[shotsIdx + 1] : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const RUTAS_PUBLICAS = ['auth/login', 'auth/reset'];
const RUTAS_AUTH = ['home', 'transporte', 'perfil', 'bitacora', 'transporte/combustible', 'transporte/conduces', 'claude'];

async function ponerIdioma(ctx, idioma) {
  // En web, Capacitor Preferences guarda en localStorage con prefijo `CapacitorStorage.`
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('CapacitorStorage.idioma', l); } catch { /* ignorar */ }
  }, idioma);
}

async function login(page) {
  const email = process.env.CSD_QA_EMAIL;
  const pass = process.env.CSD_QA_PASSWORD;
  if (!email || !pass) return false;
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', pass);
  await page.click('button[type="submit"], .btn-cta');
  await page.waitForTimeout(3500);
  const pin = process.env.CSD_QA_PIN;
  if (pin) {
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      for (const d of pin) await page.getByRole('button', { name: d, exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  return !page.url().includes('/auth/');
}

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  let visitadas = 0;
  for (const idioma of ['en', 'ht']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ponerIdioma(ctx, idioma);
    const page = await ctx.newPage();
    const misses = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' && m.text().includes('[i18n] sin traducción')) misses.push(m.text());
    });
    const rutas = [...RUTAS_PUBLICAS];
    // La sesión se intenta ANTES de las públicas para no ser redirigido; si no hay creds, solo públicas.
    const conSesion = process.env.CSD_QA_EMAIL ? await login(page) : false;
    if (conSesion) rutas.push(...RUTAS_AUTH);
    for (const ruta of rutas) {
      misses.length = 0;
      await page.goto(`${BASE}/${ruta}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(900);
      visitadas++;
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (lang !== idioma) { console.error(`✗ ${ruta} [${idioma}]: <html lang> = "${lang}"`); fallos++; }
      if (misses.length) { console.error(`✗ ${ruta} [${idioma}]: ${misses.length} sin traducir: ${misses.slice(0, 5).join(' · ')}`); fallos++; }
      else console.log(`  ✓ ${ruta} [${idioma}]`);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${ruta.replace(/\//g, '_')}-${idioma}.png`) });
    }
    await ctx.close();
  }
  await browser.close();
  if (fallos) { console.error(`\n✗ i18n-smoke: ${fallos} fallo(s).`); process.exit(1); }
  console.log(`\n✓ i18n-smoke: ${visitadas} visitas (pantalla × idioma), sin fallos.${process.env.CSD_QA_EMAIL ? '' : ' (solo rutas públicas: sin CSD_QA_EMAIL)'}`);
})();
