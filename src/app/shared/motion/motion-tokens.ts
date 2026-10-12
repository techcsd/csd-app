/**
 * CL2 — puente JS ↔ tokens de movimiento (`--motion-*` / `--ease-*` de CJ1,
 * en `src/styles/_tokens.scss`). Las directivas que animan con la Web Animations API
 * (`element.animate(...)`) necesitan los valores como string/number; para no duplicar
 * la fuente de verdad, se LEEN de las variables CSS en runtime y solo se cae a una
 * constante si el DOM no las expone (SSR / test sin estilos). Así el SCSS sigue siendo
 * la única fuente y app↔web mantienen los mismos tiempos y curvas.
 */

/** Fallbacks = copia EXACTA de `_tokens.scss` (CJ1). Solo se usan sin DOM. */
const FALLBACK = {
  '--motion-fast': '150ms',
  '--motion-base': '220ms',
  '--motion-slow': '320ms',
  '--motion-hero': '1600ms',
  '--ease-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  '--ease-in': 'cubic-bezier(0.5, 0, 0.75, 0)',
} as const;

type TokenName = keyof typeof FALLBACK;

/** Lee una variable CSS del `:root` (best-effort). Cae al fallback sin DOM. */
function readVar(name: TokenName): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || FALLBACK[name];
  } catch {
    return FALLBACK[name];
  }
}

/** Milisegundos de un token de duración (`--motion-base` → 220). */
function ms(name: TokenName): number {
  const raw = readVar(name);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : parseFloat(FALLBACK[name]);
}

/** Curvas y duraciones de movimiento, derivadas de los tokens CSS (CJ1). */
export const motionTokens = {
  get fast(): number {
    return ms('--motion-fast');
  },
  get base(): number {
    return ms('--motion-base');
  },
  get slow(): number {
    return ms('--motion-slow');
  },
  get hero(): number {
    return ms('--motion-hero');
  },
  get easeOut(): string {
    return readVar('--ease-out');
  },
  get easeIn(): string {
    return readVar('--ease-in');
  },
};

/** CL2 — contrato de escalonado (igual en web y app): 30 ms por fila, máx. 8. */
export const STAGGER_STEP_MS = 30;
export const STAGGER_MAX = 8;

/** CL2 — conteo de KPI "hacia arriba" (CL2 base §b). */
export const COUNTUP_MS = 600;

/**
 * CL2 — ids de movimiento de **sistema** (infra, no se disparan desde una pantalla):
 * el crossfade de navegación (CJ1) y la entrada de hojas/diálogos. Se listan aquí para
 * que la prueba unitaria del catálogo cuadre id-usado ↔ registrado sin inventar.
 */
export const SISTEMA_MOTION_IDS = ['xfade', 'hoja', 'login-reveal'] as const;
export type SistemaMotionId = (typeof SISTEMA_MOTION_IDS)[number];
