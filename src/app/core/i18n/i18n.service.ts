import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

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
 * Persistencia: local (`Preferences`). Cuando el padre agregue `usuarios.idioma`
 * (migración aditiva, ver HANDOFF), se sincroniza para que siga al usuario entre
 * dispositivos; mientras tanto es por dispositivo.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  /** Idioma activo. Cualquier `t()` que lo lea se vuelve reactivo al cambio. */
  private _idioma = signal<Idioma>('es');
  idioma = this._idioma.asReadonly();

  /** Catálogos cargados: { idioma: { textoEs: traducción } }. `es` no necesita uno. */
  private catalogos = signal<Partial<Record<Idioma, Record<string, string>>>>({});

  private cargando = new Set<Idioma>();

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: PREF_KEY });
      const lang = (value as Idioma) || 'es';
      if (lang !== 'es') await this.cargarCatalogo(lang);
      this._idioma.set(this.esValido(lang) ? lang : 'es');
    } catch {
      /* sin preferencia guardada → español */
    }
  }

  private esValido(l: string): l is Idioma {
    return l === 'es' || l === 'en' || l === 'ht';
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
    if (lang !== 'es' && !this.catalogos()[lang]) await this.cargarCatalogo(lang);
    this._idioma.set(lang);
    try {
      await Preferences.set({ key: PREF_KEY, value: lang });
    } catch {
      /* persistencia best-effort */
    }
    // TODO(padre): cuando exista `usuarios.idioma`, llamar mi_idioma_set(lang) aquí
    // (best-effort, online) para que el idioma siga al usuario entre dispositivos.
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
