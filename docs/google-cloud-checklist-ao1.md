# Google Cloud Console — Checklist para FASE 3 (AO1/AO2): Google Maps + Places en CSD App

> **Para:** Xaviel (ejecución manual en Google Cloud Console + SGC).
> **Prepara:** la migración de Leaflet → Google Maps y la búsqueda de lugares (Places).
> **Regla madre:** CERO keys en el repo (precedente AG1). La key sensible vive server-side (edge functions); la del mapa va **restringida**.
> **Estado app:** ya existe `GoogleMapsLoaderService` que pide la key al RPC `maps_api_key` e inyecta el **Maps JavaScript API** dentro del WebView; `seguimiento` ya pinta con Google-o-Leaflet. Falta la key + los edge functions + migrar `location-picker` y la búsqueda.

---

## Datos que vas a necesitar (ya confirmados)

| Dato | Valor |
|---|---|
| **Android package / appId** | `com.constructorasd.csdapp` |
| **SHA-1 del certificado de firma (release)** | `B3:A3:F1:CE:9B:E7:71:9B:B8:56:CF:20:83:46:60:D2:B2:10:B9:FD` |
| **Origen del WebView (APK Android)** | `https://localhost` (Capacitor por defecto, sin `server.hostname` custom) |
| **Dominio PWA (iPhone)** | `https://app.sgcconstructorasd.com` |
| **Dominio web SGC** | `https://sgcconstructorasd.com` |
| **RPC que sirve la key del mapa** | `maps_api_key` (lee `sgc.parametros`) |

> ⚠️ **Aclaración importante sobre la restricción “package + SHA-1”:** eso aplica al **Maps SDK for Android nativo**. La app **NO** usa el SDK nativo: usa el **Maps JavaScript API dentro del WebView** (una página web). Por eso la restricción correcta para la key del mapa es **HTTP referrer**, no Android app. El SHA-1 queda documentado por si algún día migramos al SDK nativo (`@capacitor/google-maps`) — ver Apéndice B.

---

## PARTE 0 — Inventario y limpieza (hacer PRIMERO)

- [ ] **Localiza la key que ya usa el weather.** Google Cloud Console → menú → **APIs y servicios → Credenciales**. Anota: en qué **proyecto** vive, cómo se llama, y en **API restrictions** qué APIs tiene habilitadas. (Xaviel notó que varios `.env` sueltos — `maps_platform_api_key.env` etc. — contienen **la misma** key general.)
- [ ] **Decide el proyecto de facturación.** Usa el **mismo proyecto** del weather si ya tiene billing activo; si no, crea/asocia una cuenta de facturación (Maps Platform exige billing aunque haya crédito gratis).
- [ ] **Revisa los `.env` sueltos** que creaste (`maps_platform_api_key.env` y similares): NO los commitees (el `.gitignore` ya los cubre). Una vez configurado todo, **consolida y bórralos**.
- [ ] **¿Alguna key llegó a commitearse al repo?** Si sí → **rótala** (crea key nueva, borra la vieja) por el precedente AG1. (Claude ya verificó que en `csd-app` NO hay ninguna key de Maps commiteada; confirma del lado web/SGC.)

---

## PARTE 1 — Crear DOS keys (separación de responsabilidades)

La idea: la key que hace búsquedas/geocoding **nunca** sale al cliente; la del mapa sí, pero restringida y solo para dibujar.

### 🔑 Key A — “CSD Server (Places/Geocoding)” — SERVER-SIDE, nunca al cliente
- [ ] Credenciales → **Crear credenciales → Clave de API**. Renómbrala `CSD Server – Places/Geocoding`.
- [ ] **Application restrictions:** `None` (la usan los edge functions de Supabase desde IP de servidor; opcional: “IP addresses” si Supabase te da rango fijo — normalmente no, dejar None).
- [ ] **API restrictions → Restrict key** → habilita SOLO:
  - **Places API** (o **Places API (New)** — ver nota abajo)
  - **Geocoding API**
  - *(opcional)* **Directions API** si algún día calculamos rutas server-side (hoy usamos OSRM; no marcar aún).
- [ ] Guarda la key. **NO la pongas en el repo.** Va como **secret de Supabase** (Parte 3).

### 🔑 Key B — “CSD Maps JS (WebView/Web)” — CLIENTE, restringida por referrer
- [ ] Credenciales → **Crear credenciales → Clave de API**. Renómbrala `CSD Maps JS – WebView/Web`.
- [ ] **Application restrictions → HTTP referrers (web sites)** → agrega EXACTAMENTE:
  - `https://localhost/*`  ← **imprescindible**: origen del WebView del APK Android
  - `https://app.sgcconstructorasd.com/*`  ← PWA iPhone
  - `https://sgcconstructorasd.com/*`  ← web SGC (si usa el mapa)
  - `http://localhost/*` y `http://localhost:*/*`  ← desarrollo local (`npm start`)
- [ ] **API restrictions → Restrict key** → habilita SOLO:
  - **Maps JavaScript API**
- [ ] Guarda la key. Esta es la que va en `sgc.parametros` (Parte 3) — es aceptable exponerla porque está restringida por referrer + API + cuota.

> **Nota Places API (New) vs clásica:** Google empuja **Places API (New)**. Para el edge function de autocompletar conviene la **(New)** (`places:autocomplete` + `places:details`). Habilita la que uses en el código del edge function; si dudas, habilita ambas al inicio y quita la clásica cuando el edge esté probado.

---

## PARTE 2 — Facturación, cuotas y alertas (protección anti-sorpresa)

- [ ] **Billing → Budgets & alerts:** crea un presupuesto (ej. USD 50/mes) con alertas al 50/90/100%.
- [ ] **APIs y servicios → (cada API) → Cuotas:** pon un tope diario razonable a Places/Geocoding (evita que un bug o abuso dispare el gasto). Sugerido inicial: Autocomplete 5k/día, Details 2k/día, Geocoding 2k/día, Maps JS loads 20k/día. Ajustable.
- [ ] **Estimación de consumo (documentar):** el uso real es bajo (una app de campo, ~decenas de choferes). El grueso será *Maps JavaScript API — Dynamic Maps* (cargas de mapa) y *Autocomplete Session + Place Details* al crear conduces/rutas. Con Autocomplete **por sesión** (token de sesión) el costo se factura por sesión, no por tecla → mantenerlo así en el edge function.

---

## PARTE 3 — Cablear las keys al sistema (SGC + Supabase)

### Key B (mapa) → `sgc.parametros`, servida por el RPC `maps_api_key`
- [ ] Verifica/crea la fila en `sgc.parametros` que lee `maps_api_key` (revisa cómo la nombra el RPC en SGC — probablemente `maps_api_key` o `google_maps_js_key`). Pega ahí **Key B**.
- [ ] Confirma que `maps_api_key` es `security definer` y **grant a los roles de la app** (para que el WebView del chofer pueda leerla). Sin grant → el mapa cae a Leaflet en silencio.

### Key A (Places/Geocoding) → secret de Supabase (solo edge functions)
- [ ] Supabase → Project → **Edge Functions → Secrets** → agrega `GOOGLE_MAPS_SERVER_KEY` = **Key A**.
- [ ] Esto es parte de **PROMPT-9 (SGC)**: crear/ajustar los edge functions
  - `places-autocomplete` (input: texto + session token + bias RD `components=country:do` / `regionCode=DO`) → sugerencias.
  - `place-details` (input: place_id + session token) → nombre + lat/lng + dirección.
  - `resolve-maps-link` (ya existe / a verificar) → link de Maps → coords.
  Todos leen `GOOGLE_MAPS_SERVER_KEY` del entorno; la key **nunca** viaja al cliente.

---

## PARTE 4 — Lo que construye Claude Code después (app-side, cuando las keys existan)

No requiere tu intervención, pero para que sepas el hand-off:
- Migrar `location-picker` (hoy Leaflet) a Google Maps JS reusando `GoogleMapsLoaderService`.
- Sustituir `GeocodingService.buscar` (Nominatim) por llamadas a `places-autocomplete` + `place-details` (edge functions), con **session token** y bias RD.
- Aplicar la búsqueda en TODOS los selectores de ubicación (crear conduce origen/destino, paradas de ruta, ubicación de obras AM7).
- Migrar el replay/seguimiento a Google (ya dual-path) y **retirar Leaflet** (`leaflet` + `@types/leaflet` + CSS) cuando todo esté migrado.

---

## PARTE 5 — Verificación (cuando termine el hand-off)

- [ ] En el APK real: crear conduce → buscar un lugar conocido de RD → aparece en la lista → al tocarlo se pinea solo (sin dibujar a mano).
- [ ] El mapa carga como **Google** (no Leaflet/OSM) — si sale Leaflet, la key B no llegó (revisa `sgc.parametros` + grant del RPC).
- [ ] Sin conexión: el mapa/búsqueda degradan sin romper (fallback).
- [ ] En **DevTools/Network** del WebView, confirmar que las búsquedas van al **edge function** (no directo a `maps.googleapis.com` con la key A).
- [ ] Google Cloud → Metrics: el consumo aparece en las APIs esperadas y dentro de cuota.

---

## Apéndice A — Resumen de qué API va con qué key

| API de Google | Key | Dónde se usa |
|---|---|---|
| Maps JavaScript API | **B** (referrer) | mapa dentro del WebView / web (cliente) |
| Places API (New) — Autocomplete + Details | **A** (server) | edge function `places-autocomplete` / `place-details` |
| Geocoding API | **A** (server) | edge function (reverse/forward geocode, `resolve-maps-link`) |

## Apéndice B — Si algún día migramos al SDK NATIVO de Android (`@capacitor/google-maps`)
Solo entonces necesitarías una **3ª key** restringida por **Android apps** con:
- Package name: `com.constructorasd.csdapp`
- SHA-1: `B3:A3:F1:CE:9B:E7:71:9B:B8:56:CF:20:83:46:60:D2:B2:10:B9:FD`
y habilitar **Maps SDK for Android**. Hoy NO hace falta (usamos el JS API en WebView).

> Si rotas el keystore de firma en el futuro, el SHA-1 cambia y habría que actualizarlo aquí.
