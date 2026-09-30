# PARIDAD — CSD App (móvil) ↔ SGC (web)

> Regla 5 (interconexión/consistencia): la app y la web comparten **los mismos
> nombres y valores de token semántico**. Este archivo registra la paridad del
> rediseño **CB (v2, 28/09/2026)** y las divergencias **deliberadas** (no son
> bugs; no "corregir" para igualar a la web).

## Fuente de verdad
- Web: `SGC/src/styles/_tokens.scss` (semántico = fuente, `--sgc-*` = alias).
- App: `csd-app/src/styles/_tokens.scss` (**shim inverso, BH5**): `--color-*` = fuente
  de valores (194 componentes la consumen), los nombres semánticos de la web
  (`--bg`, `--surface`, `--brand`, `--accent`, `--text`, `--success/-bg`…) son
  **alias** que apuntan a `--color-*`. Resultado: **mismos valores semánticos** que la web.

## Tokens con VALOR IDÉNTICO a la web (CB v2, claro / oscuro)
Superficies (`--bg #f5f6f8`/`#0b121c`, `--surface #ffffff`/`#111a26`, `--surface-2`,
`--surface-3`, `--border #e4e7ec`/`#1e2b3c`, `--border-strong`), texto (`--text
#101828`, `--text-2 #5b6b80`, `--text-3 #7a8799`), marca+acento (`--brand #1e3a5f`,
`--brand-hover #17304f`, `--brand-soft #eef3f9`, `--accent #f97316`, `--accent-hover
#ea580c`, `--accent-soft #fff4ec`, **`--text-on-accent #14243a`** = tinta navy sobre
naranja, AA 5.6:1), estados (`--success #067647`/`--success-bg #ecfdf3`, `--warning
#b54708`/`#fffaeb`, `--danger #b42318`/`#fef3f2`, `--info #175cd3`/`#eff8ff`),
`--dot-*`, `--nav-bg #0f1f33`, sombras (`--shadow-sm/--shadow/--shadow-md/--shadow-lg/
--shadow-pop`), foco (`--focus-ring` halo navy 4px), **vidrio** (`--glass-bg/-border/
-shadow/-blur`, blur 20px saturate 180 %), tipografía (`--font-body Inter`,
`--font-display Inter Tight`, auto-hospedadas, mismos woff2), escala fs 12→32.
Oscuro: brand `#2e75b6` (relleno con texto blanco AA 5:1), accent `#fb923c`, etc.

## Divergencias DELIBERADAS (documentadas, NO igualar)
| Token | App | Web | Motivo |
|---|---|---|---|
| `--radius-sm` | **10px** | 8px | Objetivos de campo con guantes (BH5) |
| `--radius` | **14px** | 10px | idem |
| `--radius-lg` | **18px** | 16px | idem |
| `--radius-xl` | 24px | 24px | (igual) |
| `--transition` | **`0.15s ease`** (fragmento) | `all 0.2s ease` | Se usa como `transition: transform var(--transition)` en option-button/pin-pad/big-button/step-bar → NO puede llevar `all` (quedaría inválido). BH5. |
| Arquitectura shim | `--color-*` = fuente, semántico = alias | semántico = fuente, `--sgc-*` = alias | La app **no migró** sus 194 componentes; se invierte el shim a propósito (BH5). |
| `bottom-sheet` radio | 28px (one-off) | — | Hoja inferior de la app (mock CB). |

## Amber histórico
`--Hub` (#ffb300, ex-marca) ahora es **alias de `--accent`** (naranja) para no romper
sus 131 referencias (§E). Paridad de intención: una sola marca + un acento.

## CC (ronda 29-30/09/2026) — decisiones de paridad app↔web
- **CC4 · Importar datos desde Odoo (proveedores/vehículos/artículos): SOLO WEB.** Es
  trabajo de escritorio (subir un `.xlsx`/`.csv` exportado de Odoo, mapear columnas,
  previsualizar transformaciones, deshacer). La app de campo **no lo lleva** (regla del
  proyecto: la app no es un mini-SGC). El asistente vive en la web (Compras/Flota/
  Inventario, según el gate de entidad). — *Sin equivalente en la app, a propósito.*
- **CC6 · N.º de recibo en la echada:** la app **captura** `numero_recibo` y lo guarda
  en el borrador y el registro local; el envío lo manda **detrás de comprobación de
  capacidad** (el `registrar_combustible_app` del padre aún **no** tiene el parámetro
  `p_numero_recibo` — hueco anotado). Cuando el padre lo añada, se persiste solo.
- **CC8 · Órdenes de trabajo:** la app ya usaba el RPC definer `orden_trabajo_detalle`
  (no toca `bitacora_orden_detalle` directo); el bug era de grants en la web (lo arregló
  el padre). Sin cambios en la app.
