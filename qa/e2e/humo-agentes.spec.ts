// qa/e2e/humo-agentes.spec.ts — smoke e2e de la PWA para el carril de agentes (EA3/F8).
// Qué hace: abre la PWA, entra con una cuenta QA y comprueba que Inicio y «Nueva requisición» cargan sin errores de página.
// Por qué existe: agente-promocion.yml solo verifica que el despliegue esté sano (Vercel READY + health); esto detecta pantallas rotas.
//
// Entorno (nunca commitear valores): CSD_QA_BASE (URL de la PWA), CSD_QA_EMAIL, CSD_QA_PASSWORD, opcional CSD_QA_PIN (4 dígitos).
// Cuenta probada: qa_ingeniero_campo@constructorasd.com (prod) — tiene compras.solicitudes «operar». Otras (ingeniero_oficina, capataz) no entran a /solicitudes/pedir y el test falla a propósito.
// Uso: npm i --no-save @playwright/test && npx playwright install chromium && npx playwright test -c qa/e2e/playwright.config.ts
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env['CSD_QA_BASE'] || 'http://localhost:4200';
const EMAIL = process.env['CSD_QA_EMAIL'];
const PASS = process.env['CSD_QA_PASSWORD'];
const PIN = process.env['CSD_QA_PIN'];

test.use({ baseURL: BASE, viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ context }) => {
  // Idioma ya elegido: evita el aviso «Antes de continuar» de la primera vez (Capacitor Preferences en web = localStorage).
  await context.addInitScript(() => { try { localStorage.setItem('CapacitorStorage.idioma', 'es'); } catch { /* ignorar */ } });
});

async function entrar(page: Page): Promise<void> {
  await page.goto('/auth/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL!);
  await page.fill('input[type="password"]', PASS!);
  await page.click('button[type="submit"], .btn-cta');
  await page.waitForTimeout(3500);
  if (PIN) {
    // El PIN de la app se pide dos veces (crear + confirmar) la primera vez en un contexto limpio.
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click().catch(() => undefined);
      await page.waitForTimeout(1200);
    }
  }
  await expect(page).not.toHaveURL(/\/auth\//, { timeout: 15000 });
}

// Un goto recarga la app y el PIN vuelve a pedirse («Escribe tu PIN»): se teclea otra vez.
async function ir(page: Page, ruta: string): Promise<void> {
  await page.goto(ruta, { waitUntil: 'networkidle' });
  if (PIN && (await page.getByRole('heading', { name: 'Escribe tu PIN' }).isVisible().catch(() => false))) {
    for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).first().click();
    await page.waitForTimeout(1500);
  }
}

test.describe('humo de la PWA (carril de agentes)', () => {
  test.skip(!EMAIL || !PASS, 'faltan CSD_QA_EMAIL / CSD_QA_PASSWORD');

  test('Inicio y Nueva requisición cargan sin errores', async ({ page }) => {
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));

    await entrar(page);

    // Inicio
    await ir(page, '/home');
    await expect(page.locator('.home__greeting')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-root')).not.toContainText('Reparar'); // pantalla de rescate del arranque

    // Nueva requisición
    await ir(page, '/solicitudes/pedir');
    await expect(page.locator('h1.mov__title')).toContainText('Nueva requisición', { timeout: 15000 });

    expect(errores, errores.join('\n')).toEqual([]);
  });
});
