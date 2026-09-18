import { inject, Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { SupabaseService } from '../services/supabase.service';

/** BR7 — idiomas soportados. `es` es el idioma base (las CLAVES de traducción SON
 *  el texto en español, así que `es` nunca necesita catálogo y funciona 100%
 *  offline). `en` y `ht` (kreyòl) son superposiciones: una clave sin traducir cae
 *  al español. `ht` arranca como catálogo vacío (listo para traducir). */
export type Idioma = 'es' | 'en' | 'ht';

export const IDIOMAS: { code: Idioma; nativo: string }[] = [
  { code: 'es', nativo: 'Español' },
  { code: 'en', nativo: 'English' },
  { code: 'ht', nativo: 'Kreyòl ayisyen' },
];

/** BT2 (regla 17) — un idioma se ofrece "de verdad" cuando cubre su alcance. Debajo
 *  del umbral se marca **beta** (con el % real); muy debajo se deja "próximamente"
 *  (deshabilitado). `es` siempre está al 100% (es el idioma base). */
const UMBRAL_OFRECIDO = { en: 95, ht: 90 } as const;
/** ht deshabilitado ("próximamente") hasta este %. en nunca se deshabilita: cae a
 *  español clave a clave, así que se ofrece como beta con expectativa honesta. */
const UMBRAL_HABILITADO = { en: 0, ht: 90 } as const;

/** BT2 — estado de un idioma para el selector/onboarding. */
export interface IdiomaEstado {
  code: Idioma;
  nativo: string;
  pct: number;
  /** Cubre el alcance (≥ umbral) → sin etiqueta beta. */
  ofrecido: boolean;
  /** Debajo del umbral pero usable → "beta · cubre n%". */
  beta: boolean;
  /** Muy debajo → no seleccionable ("próximamente"). */
  deshabilitado: boolean;
}

const PREF_KEY = 'idioma';

/**
 * BR7 — selector de idioma en runtime, sin `@angular/localize` (que obliga a un
 * build por idioma: inaceptable para un APK único). Diccionario en memoria con
 * signals: cambiar el idioma re-renderiza sin recargar. Las CLAVES son el texto en
 * español; `t()` devuelve el español tal cual cuando el idioma es `es` o cuando la
 * traducción no existe todavía → nunca se ve una clave cruda en pantalla.
 *
 * Los textos que vienen del SERVIDOR (catálogos, nombres de obra, mensajes de
 * negocio como DR481) siguen en español — no pasan por aquí (documentado en Perfil).
 *
 * Persistencia: local (`Preferences`) para respuesta inmediata/offline, Y en el
 * servidor (`usuarios.idioma` vía `mi_idioma_set`) para que el idioma siga al
 * usuario entre dispositivos (UserContextService lo adopta al cargar el perfil).
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private supabase = inject(SupabaseService);

  /** Idioma activo. Cualquier `t()` que lo lea se vuelve reactivo al cambio. */
  private _idioma = signal<Idioma>('es');
  idioma = this._idioma.asReadonly();

  /** Catálogos cargados: { idioma: { textoEs: traducción } }. `es` no necesita uno. */
  private catalogos = signal<Partial<Record<Idioma, Record<string, string>>>>({});

  private cargando = new Set<Idioma>();

  /** BT2 — cobertura real por idioma (generada por `scripts/i18n-coverage.mjs`). */
  private _cobertura = signal<{ en: number; ht: number }>({ en: 0, ht: 0 });
  cobertura = this._cobertura.asReadonly();

  /** BT2 — un aviso, una vez: "Kreyòl estará disponible pronto" (si el usuario tenía
   *  ht guardado pero aún no está habilitado). Lo consume el shell para el toast. */
  private _avisoIdiomaDegradado = signal<string | null>(null);
  avisoIdiomaDegradado = this._avisoIdiomaDegradado.asReadonly();
  limpiarAvisoIdioma(): void {
    this._avisoIdiomaDegradado.set(null);
  }

  constructor() {
    void this.init();
  }

  /** BT2 — lee `i18n/coverage.json` (best-effort). Si falta, queda en 0% → los
   *  idiomas no-base se muestran beta/próximamente (conservador y honesto). */
  private async cargarCobertura(): Promise<void> {
    try {
      const res = await fetch('i18n/coverage.json', { cache: 'no-cache' });
      if (res.ok) {
        const c = (await res.json()) as { en?: number; ht?: number };
        this._cobertura.set({ en: c.en ?? 0, ht: c.ht ?? 0 });
      }
    } catch {
      /* sin coverage.json → 0% (idiomas no-base beta/próximamente) */
    }
  }

  /** BT2 — estado de cada idioma para el selector (ofrecido / beta / próximamente). */
  estadoIdiomas(): IdiomaEstado[] {
    const cob = this._cobertura();
    return IDIOMAS.map((i) => {
      if (i.code === 'es') {
        return { ...i, pct: 100, ofrecido: true, beta: false, deshabilitado: false };
      }
      const pct = cob[i.code] ?? 0;
      const deshabilitado = pct < UMBRAL_HABILITADO[i.code];
      const ofrecido = pct >= UMBRAL_OFRECIDO[i.code];
      return { ...i, pct, ofrecido, beta: !ofrecido && !deshabilitado, deshabilitado };
    });
  }

  /** BT2 — ¿este idioma está habilitado (seleccionable)? */
  habilitado(code: Idioma): boolean {
    return !this.estadoIdiomas().find((e) => e.code === code)?.deshabilitado;
  }

  private async init(): Promise<void> {
    // BT2 — la cobertura decide si un idioma guardado sigue disponible.
    await this.cargarCobertura();
    // BS4 — orden de fuentes al arrancar (antes de que haya sesión): local → idioma
    // del dispositivo → `es`. El servidor manda cuando llega el perfil
    // (UserContextService → adoptFromServer), así que el orden completo efectivo es
    // servidor → local → dispositivo → es.
    let lang: Idioma = 'es';
    try {
      const { value } = await Preferences.get({ key: PREF_KEY });
      lang = this.esValido(value ?? '') ? (value as Idioma) : this.deviceLang();
    } catch {
      lang = this.deviceLang();
    }
    lang = this.degradarSiHaceFalta(lang);
    if (lang !== 'es') await this.cargarCatalogo(lang).catch(() => {});
    this._idioma.set(lang);
  }

  /**
   * BT2 — si el idioma pedido aún no está habilitado (p. ej. Kreyòl < 90%), cae a
   * español y deja UN aviso para mostrarlo una vez. Así un usuario que ya tenía `ht`
   * guardado (local o servidor) no se queda con media app en español sin explicación.
   */
  private degradarSiHaceFalta(lang: Idioma): Idioma {
    if (lang !== 'es' && !this.habilitado(lang)) {
      const nombre = IDIOMAS.find((i) => i.code === lang)?.nativo ?? lang;
      this._avisoIdiomaDegradado.set(`${nombre} estará disponible pronto. Seguirás en español por ahora.`);
      return 'es';
    }
    return lang;
  }

  private esValido(l: string): l is Idioma {
    return l === 'es' || l === 'en' || l === 'ht';
  }

  /**
   * BS4 — idioma del DISPOSITIVO si es uno de los soportados, si no `es`. Se usa
   * como fuente de arranque (cuando no hay preferencia local ni de servidor) y como
   * PRESELECCIÓN del diálogo de primer ingreso. `ht` cubre `ht` y `ht-HT`; el kreyòl
   * a veces se reporta como `fr`/`fr-HT` en equipos viejos → NO lo mapeamos a `ht`
   * (preferimos `es`/preselección explícita antes que adivinar mal).
   */
  deviceLang(): Idioma {
    try {
      const cands = [
        ...(Array.isArray(navigator.languages) ? navigator.languages : []),
        navigator.language || '',
      ];
      for (const raw of cands) {
        const primary = String(raw).toLowerCase().split('-')[0];
        if (primary === 'es' || primary === 'en' || primary === 'ht') return primary;
      }
    } catch {
      /* sin navigator → es */
    }
    return 'es';
  }

  /**
   * Traduce `esText` al idioma activo. Interpola `{clave}` con `params`. Si el
   * idioma es `es`, o no hay traducción para esa clave, devuelve el español.
   */
  t(esText: string, params?: Record<string, string | number>): string {
    const lang = this._idioma(); // ← lectura reactiva: re-render al cambiar idioma
    let out = esText;
    if (lang !== 'es') {
      const dict = this.catalogos()[lang];
      const tr = dict?.[esText];
      if (tr) out = tr;
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return out;
  }

  /** Cambia el idioma (persistente). Carga el catálogo la primera vez. */
  async setIdioma(lang: Idioma): Promise<void> {
    if (!this.esValido(lang)) return;
    // BT2 — no dejes elegir un idioma aún deshabilitado (ht < 90%).
    if (!this.habilitado(lang)) {
      this.degradarSiHaceFalta(lang);
      return;
    }
    if (lang !== 'es' && !this.catalogos()[lang]) await this.cargarCatalogo(lang);
    this._idioma.set(lang);
    try {
      await Preferences.set({ key: PREF_KEY, value: lang });
    } catch {
      /* persistencia best-effort */
    }
    // BR7 — sincroniza el idioma en el servidor (usuarios.idioma) para que siga al
    // usuario entre dispositivos. Best-effort/online: si falla, la preferencia local
    // ya quedó guardada y se reintenta en el próximo cambio.
    try {
      await this.supabase.client.rpc('mi_idioma_set', { p_idioma: lang });
    } catch {
      /* offline / RPC aún no desplegado → solo local (degrada bien) */
    }
  }

  /** BR7 — adopta el idioma que trae el perfil del servidor (cross-device). NO
   *  re-escribe el servidor (evita bucle): solo aplica local + persiste en el
   *  dispositivo. La llama UserContextService al cargar el perfil. */
  async adoptFromServer(lang: string): Promise<void> {
    if (!this.esValido(lang) || this._idioma() === lang) return;
    // BT2 — el servidor puede traer `ht` de la web; si aún no está habilitado en la
    // app, cae a español con el aviso de una sola vez.
    if (!this.habilitado(lang)) {
      this.degradarSiHaceFalta(lang);
      return;
    }
    if (lang !== 'es' && !this.catalogos()[lang]) await this.cargarCatalogo(lang);
    this._idioma.set(lang);
    try {
      await Preferences.set({ key: PREF_KEY, value: lang });
    } catch {
      /* best-effort */
    }
  }

  /** Carga `assets/i18n/<lang>.json` (SW-cacheado offline). Best-effort: si falla
   *  —p.ej. cold boot offline sin caché— el idioma cae al español sin romper nada. */
  private async cargarCatalogo(lang: Idioma): Promise<void> {
    if (lang === 'es' || this.catalogos()[lang] || this.cargando.has(lang)) return;
    this.cargando.add(lang);
    try {
      const res = await fetch(`i18n/${lang}.json`, { cache: 'force-cache' });
      if (res.ok) {
        const dict = (await res.json()) as Record<string, string>;
        this.catalogos.update((c) => ({ ...c, [lang]: dict }));
      }
    } catch {
      /* offline sin caché → se queda en español */
    } finally {
      this.cargando.delete(lang);
    }
  }
}
