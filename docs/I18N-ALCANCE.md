# Alcance de i18n — CSD App (DP-14, CONTEXTO-72)

«100 %» aquí significa **100 % de lo que mide `scripts/i18n-coverage.mjs`**: texto de
plantillas HTML (nodos de texto + `placeholder`) y literales de UI en `.ts` (toasts,
confirm/alert, `mensaje`/`error`, `placeholder`, `throw new Error`, signals de mensaje,
y etiquetas constantes `label`/`titulo`/`texto`/`sub`/`cta` que se traducen **al mostrar**).
El número honesto sale de `docs/I18N-COVERAGE.md` / `public/i18n/coverage.json`; **nunca
se declara 100 % a mano** (el selector lo deriva de ese número: `I18N_UMBRAL = 100/100`).

## SÍ se traduce (es / English / Kreyòl)

- Toda la interfaz: plantillas HTML y los textos de UI dentro de `.ts`.
- Fechas: pipe `fecha` y `localeActual()`/`fechaCorta()` cambian con el idioma
  (Kreyòl con tabla propia de meses/días: ningún motor trae CLDR real de `ht`).
- Selector de idioma, onboarding de idioma y Perfil › Idioma.
- `<html lang>` sigue al idioma activo.

## NO se traduce (queda en español por diseño)

| Qué | Por qué | Cómo se ampliaría |
|---|---|---|
| Catálogos de la BD (tipos, categorías, estados de catálogo, plantillas de ayuda `ayuda_contenido`) | Datos de negocio, no copy de interfaz | Columna/tabla de traducciones en el SGC + leer por idioma |
| Nombres de obra, proyecto, proveedor, artículo, vehículo | Nombres propios reales | — |
| Mensajes de negocio devueltos por RPC (errores de dominio, p. ej. DR481, `error_campo`) | Los genera el servidor en español | Pasar el idioma a la RPC o mapear `error_code` → clave en la app |
| Notificaciones push y correos | Se generan en el servidor | Plantilla por idioma en la función que notifica |
| PDF generados en el teléfono con jsPDF (conducto, cartilla, orden de trabajo, carnet, nota de reunión) y su resumen en la cola | Documentos administrativos/legales; cambiarlos implica una plantilla por idioma | Extraer sus literales a `t()` con `{param}` y regenerar el PDF en el idioma del usuario |
| Respuestas de Compa / Claude y contenido de skills | Las genera el modelo / usuarios | Instrucción de idioma en el prompt de Compa |
| `aria-label`, `alt`, `title` | Accesibilidad/tooltips, fuera de la definición de «texto visible» del escáner | Incluirlos en el escáner |
| Texto de desarrolladores (pantalla «Sin proyecto configurado», comandos `npm`, `ng serve`) | Solo ve el equipo técnico; los tokens de código van en la whitelist | — |
| Mensajes con interpolación de plantilla de TS (`` `…${x}…` ``) que aún no usan `t('…{x}', {x})` | El escáner no los detecta; los 4 conocidos se migraron a claves con `{param}` | Revisar con el smoke de idioma |
| Aviso «\<Idioma\> estará disponible pronto» (solo si el servidor trae un idioma deshabilitado) | Si el idioma no está disponible, el texto sale en español por definición | — |

## Calidad por idioma

- **Español**: base; las claves SON el texto en español.
- **English**: traducción directa de Claude (inglés internacional neutro).
- **Kreyòl ayisyen**: generado por Claude con `docs/I18N-GLOSARIO.md`, **sin validar por un
  hablante**. Los ~150 textos más vistos están en `docs/I18N-REVISAR-HT.md` para su revisión
  humana antes de ofrecerlo a las cuadrillas. Las frases partidas alrededor de negritas
  (p. ej. Soporte › batería) se traducen como fragmentos y pueden leerse torpes en Kreyòl.

## Guardias

`prebuild`: `i18n-coverage` (mide) → `verify-i18n` (falla si una pantalla `enforce:true` tiene
literales sin `t()` o claves sin traducción en en/ht, o si un catálogo pierde un `{param}`).
`npm run i18n:smoke` recorre las pantallas principales en `en` y `ht` (requiere `npm start`).
`node scripts/i18n-paridad.mjs` reporta divergencias con el catálogo de la web (solo informe).
