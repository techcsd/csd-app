# App en blanco → “Android System WebView” viejo (guía + inventario)

**Qué es esto:** en agosto 2026 se descubrió, probando en un Huawei STK-LX3, que la
app arrancaba **en blanco total** en teléfonos cuyo *Android System WebView* (el
motor Chromium que dibuja la app dentro del APK) es muy viejo. La app está hecha
con Angular 21, que **no corre** por debajo de ~Chromium **111**; ese equipo tenía
Chromium **81** → el bundle ni se lee → pantalla blanca sin explicación.

**Ya mitigado (v1.57.0):** la app ahora **detecta** el WebView viejo antes de
cargar y, en vez del blanco, muestra un aviso claro con botón **ACTUALIZAR**.
Pero un equipo que quedó en blanco con una versión ANTERIOR a la 1.57.0 no puede
auto-actualizarse solo (el chequeo vive dentro de la app) → hay que actualizarle
el WebView a mano o reinstalar el APK 1.57.0+.

---

## Para el chofer — cómo actualizar (pasos simples)

Si tu app te muestra el aviso “Actualiza el navegador del sistema” **o** te sale
en blanco:

1. Toca el botón naranja **ACTUALIZAR** (si lo ves). Te lleva a la tienda.
2. Si no, abre **Play Store** → busca **“Android System WebView”** → **Actualizar**.
   - En algunos teléfonos también hay que actualizar **Google Chrome**.
3. Cuando termine, **cierra y vuelve a abrir** la app CSD.
4. ¿No te deja actualizar (teléfono sin Play Store / muy viejo)? → **avísale a
   Tecnología**. Puede que ese equipo no sirva para la app y haya que cambiarlo.

> Necesitas **internet** (WiFi o datos) para actualizar.

---

## Para Tecnología — inventariar el riesgo del parque de equipos

El riesgo real es cuántos teléfonos de campo tienen WebView < 111. Cómo revisarlo:

**En el teléfono (sin PC):**
- Ajustes → Apps → busca **“Android System WebView”** → mira la **versión**.
  El primer número es el Chromium (ej. `81.0.4044.138` → 81). Si es **< 111**, la
  app no corre ahí sin actualizar.
- O simplemente abre la app CSD 1.57.0+: si sale el aviso naranja, está viejo (y
  te dice el número).

**Con PC + ADB (rápido, por equipo):**
```bash
adb shell dumpsys webviewupdate | grep "Current WebView package"
# → (com.google.android.webview, 81.0.4044.138)  ← 81 = muy viejo
```

**Qué hacer según el caso:**
- **Tiene Play Store (con Google):** actualizar WebView + Chrome desde Play. Queda
  resuelto.
- **Huawei/equipo sin Google (no puede actualizar WebView):** ese modelo se queda
  en Chromium viejo para siempre → **no sirve** para esta app. Cambiar el equipo o
  usar la PWA en un navegador Chrome actualizado del propio teléfono como paliativo.

**Umbral:** el guard bloquea por debajo de Chromium **111** (piso real de Angular
21, “baseline widely available”). Se ajusta en un solo lugar:
`android/app/src/main/java/com/constructorasd/csdapp/MainActivity.java`
→ `MIN_CHROMIUM_MAJOR`.

---

## Nota técnica (por qué no se “arregla” bajando el build)

Angular 21 **rechaza** compilar para navegadores por debajo de su baseline
(esbuild: *“Transforming destructuring to chrome80 is not supported”*). No se
puede generar un bundle que corra en Chromium 81 con este framework. Por eso la
solución es **detectar + avisar** (v1.57.0), no “downgradear” la compilación. Si a
futuro hay muchos equipos irrecuperables, la única vía sería empacar un WebView
moderno propio con la app (cambio grande, APK mucho más pesado).
