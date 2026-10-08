/**
 * CI12 — Capturas de tienda con Playwright contra **app-dev** y el usuario revisor.
 * Genera PNG sin marcos para Google Play (1080×1920) y App Store (1320×2868, 6.9").
 *
 * Requisitos (una vez):
 *   npm i -D playwright && npx playwright install chromium
 * Credenciales del revisor demo en .env.local (NO en git):
 *   STORE_REVIEW_EMAIL=revision.tiendas@constructorasd.com
 *   STORE_REVIEW_PASSWORD=...
 * Uso:
 *   node scripts/store/capturas.mjs           # app-dev (default)
 *   STORE_URL=https://app-dev.sgcconstructorasd.com node scripts/store/capturas.mjs
 *
 * Salida: dist-store/capturas/play/1080x1920/*.png y dist-store/capturas/ios/1320x2868/*.png
 * Nota: el revisor demo solo ve la OBRA DEMO (rol revisor_tiendas) — sin datos reales.
 */
import { mkdirSync } from 'node:fs';
import { readFileSync, existsSync } from 'node:fs';

function envLocal(k) {
  if (process.env[k]) return process.env[k];
  if (!existsSync('.env.local')) return '';
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === k) return line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

const BASE = process.env.STORE_URL || 'https://app-dev.sgcconstructorasd.com';
const EMAIL = envLocal('STORE_REVIEW_EMAIL');
const PASSWORD = envLocal('STORE_REVIEW_PASSWORD');
if (!EMAIL || !PASSWORD) {
  console.error('✗ Faltan STORE_REVIEW_EMAIL / STORE_REVIEW_PASSWORD en .env.local (usuario revisor demo).');
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('✗ Playwright no está instalado. Corre: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

// Pantallas a capturar (ruta + nombre de archivo). Ajusta las rutas si cambian.
const PANTALLAS = [
  { ruta: '/home', nombre: '1-inicio' },
  { ruta: '/transporte', nombre: '2-transporte' },
  { ruta: '/transporte/combustible', nombre: '3-combustible' },
  { ruta: '/bitacora', nombre: '4-bitacora' },
  { ruta: '/inventario', nombre: '5-inventario' },
  { ruta: '/compa', nombre: '6-compa' },
];

const PERFILES = [
  { carpeta: 'play/1080x1920', width: 1080, height: 1920 },
  { carpeta: 'ios/1320x2868', width: 1320, height: 2868 },
];

async function login(page) {
  await page.goto(`${BASE}/auth/login`, { waitUntil: 'networkidle' });
  // Campo de correo + contraseña (modo email). Ajusta selectores si cambian.
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  // Si aparece la pantalla de aceptación de políticas, acéptala.
  const acepto = page.getByText('Acepto', { exact: true });
  if (await acepto.count()) {
    await acepto.first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
}

for (const perfil of PERFILES) {
  const outDir = `dist-store/capturas/${perfil.carpeta}`;
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: perfil.width, height: perfil.height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await login(page);
  for (const p of PANTALLAS) {
    try {
      await page.goto(`${BASE}${p.ruta}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${outDir}/${p.nombre}.png` });
      console.log(`✓ ${perfil.carpeta}/${p.nombre}.png`);
    } catch (e) {
      console.warn(`⚠️  ${p.ruta}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await browser.close();
}
console.log('\n✓ Capturas en dist-store/capturas/ (play 1080×1920 + ios 1320×2868).');
