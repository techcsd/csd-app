# I18N-AVANCE — ronda DP (13-nov-2026, PROMPT-147)

Números medidos por `scripts/i18n-coverage.mjs` (no a mano). «Antes» = baseline de F0.

| Métrica | Antes | Ahora |
|---|---:|---:|
| Pantallas medidas | 264 (HTML) | 288 (HTML + `.ts`) |
| Textos medidos | 5.824 (solo HTML) | 8.388 (HTML + `.ts` + etiquetas constantes) |
| Literales HTML sin `t()` | 308 | 0 |
| Literales `.ts` sin `t()` | ≈110 estimados (323 medidos con el escáner nuevo) | 0 |
| Claves `en.json` | 4.619 | 5.982 |
| Claves `ht.json` | 132 | 5.844 |
| Cobertura English / Kreyòl | 88 % / 3 % | **100 % / 100 %** (medido) |
| Pantallas `enforce:true` | 3 | 250 de 250 |
| `\| date` / `toLocale*('es')` / `Intl('es')` | 14 / 8 / 3 | 0 / 0 (kardex, mi-recorrido pasan por `localeActual`) / 3 `NumberFormat`/`toLocaleString` numéricos que se quedan en `es-DO` por decisión |

## Lotes
1. Base: `<html lang>`, log dev de claves sin traducir, escáner `.ts`, pipe `fecha`, codemods (`i18n-wrap-html`, `i18n-wrap-ts`), cableado de 264 textos HTML + ~150 literales `.ts`.
2. Catálogos: reuso de SGC (193 en / 1.176 ht idénticas) + traducción por lotes (~330 claves/lote, 13 lotes ht, 3 en, 2 de remate); guardias estrictas.

## Lo que el 100 % NO significa
Ver `docs/I18N-ALCANCE.md`. El Kreyòl **no está validado por un hablante** (`docs/I18N-REVISAR-HT.md`, 168 textos más vistos). Algunas oraciones partidas alrededor de negritas (Soporte › batería) están traducidas por fragmentos.

## Verificación
`npm run build` (prebuild con todas las guardias) ✔ · `ng test` 66/66 ✔ · captura Playwright en dev (QA desarrollador y QA flota elevado), `en` y `ht`, 390 px: 0 claves sin traducir y `<html lang>` correcto en home, transporte, conduces, combustible, perfil, claude, perfil/claude. `bitacora` devuelve 403 para ambos usuarios QA (sin rol) → no verificada visualmente.
