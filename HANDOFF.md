# HANDOFF — CSD App

## Actualización 6 (X1–X4) — build verde, NADA commiteado/pusheado (2026-07-16)
Documentos de conductor/vehículo + aviso de GPS + confirmación de foto en salidas. `npm run build` OK (exit 0).

**⚠️ Contradicción con el prompt (el código manda):** el prompt decía bucket `documentos/{entidad}/{id}/…`.
En la BD real **no existe** un bucket `documentos`; el que creó PROMPT-13 se llama **`flota-documentos`**
(privado). Se usó ese. La tabla `sgc.documentos` (id/entidad/entidad_id/tipo/nombre/path/subido_por/created_at)
**sí existe**; RLS de tabla y de storage: `is_admin() OR tiene_modulo('flota')` para INSERT/SELECT/DELETE
(sin RPC → el app inserta directo por PostgREST). No hizo falta migración.

- **X1 documentos — nuevo:** `core/models/documento.model.ts`, `core/services/documentos.service.ts`
  (getDocumentos cacheado offline, getSignedUrl, tiposEnCola desde el outbox, `enqueueDocumento` → outbox
  `documento_upload`: sube el blob a `flota-documentos/{entidad}/{id}/{tipo}_{uuid}.{ext}` y hace UPSERT
  en `sgc.documentos` con id=UUID cliente = idempotente). Nuevo `shared/ui/doc-slot` (foto con cámara O
  archivo/PDF; modo `soloLectura` para vehículos). `camera.service`: `pickDocument()` (input file
  image/*,pdf; comprime imagen, PDF tal cual) + `takeDocumentPhoto()`.
  - **Conductor (auto-registro, `asignar`):** sección "Documentos" con slots **Cédula** y **Licencia**
    (requeridos pero NO bloqueantes). Se encolan tras `auto_registrar_conductor` con el `conductor_id`.
  - **Conductor (perfil, `mi-actividad`):** banner "Documentos pendientes: cédula · licencia" (no bloquea),
    slots para ver (signed URL) / subir / reemplazar. Funciona offline (encola + sube al reconectar).
  - **Vehículo (`perfil-vehiculo`):** sección "Documentos" **solo lectura** (Seguro, Matrícula, otros N).
    Se suben desde la web; el app solo los ve.
- **X2 GPS entrega/recepción — ya se mandaba** (`checklist.captureGps` → `enqueueEntrega` `p_gps` →
  `crear_entrega_vehiculo(p_gps jsonb)` persiste). **Añadido:** estado visible en el resumen
  (📍 Capturada / Obteniendo… / Sin ubicación) + mensaje claro y botón "Reintentar ubicación" cuando el
  permiso está denegado o no hay señal. **Nunca bloquea** (se registra "sin ubicación"). El mostrarlo en
  la web (mini-mapa/coords) es **lado SGC**.
- **X3 fotos por-ítem del pre-uso = lado SGC** (la app ya sube `item_N`; la web debe pintarlas). Fuera de scope app.
- **X4 foto en salidas — ya estaba en el app** (`salida.foto` + `enqueueSalida` → `fotoOf` sube a
  `{id}/evidencia.jpg` → `registrar_salida_app(p_foto_path)`). Mostrarla en el detalle web es **lado SGC**.

**APK QA:** bump **1.7.2 → 1.8.0** (versionCode 1008000) en `build.gradle` + `environment(.prod).ts` +
`release-apk.mjs` (VERSION + changelog/TITULO de Actualización 6 ya redactados). `npm run apk` → APK
firmado (cert prod SHA-256 3c5316d8…df5065) **instalado** en device 6dbf1af4 (`adb install -r` → Success).
**NO publicado** (no se corrió `release-apk.mjs`; bucket/mínima intactos).

**Pendiente:** device-QA en 1.8.0. Probar: auto-registro con docs (online/offline), banner pendientes,
ver docs de vehículo, entrega/recepción con y sin permiso de GPS, salida con foto — y verificar en SGC web.
**Ojo:** el auto-registro/subida escribe en producción (conductor ligado a tu usuario real / vehículos
reales) → usar registros QA-TEST. **Publicar 1.8.0 (`npm run apk:publish`) + commit/push: a tu OK.**

## Actualización 4 (W1–W7) — build verde, NADA commiteado/pusheado
Bitácora: fotos ilimitadas + equipos alquilados + paridad con la web. `npm run build` limpio.
Backend: 2 migraciones aditivas aplicadas (crear_bitacora_app canónico + mis_rutas_hoy.notas).

- **W1 fotos sin límite:** `camera.service.pickFromGallery()` (multi-pick nativo `Camera.pickImages` /
  input múltiple PWA, comprimido). Paso de fotos de la bitácora: botones **📷 Cámara** + **🖼️ Galería**,
  contador de agregadas, sin tope duro (batch hasta 40 configurable). Sube por outbox (cada foto es un
  `fotos_pendientes` slot `foto_i` → el handler arma `p_fotos`) sin bloquear el envío. El detalle ya
  las muestra todas.
- **W2 equipos alquilados:** paso "¿Hay equipos alquilados en uso hoy?" (Sí/No + lista dinámica:
  equipo con `<datalist>` de sugerencias `getEquiposSugeridos()`, uso obligatorio, proveedor opcional).
  Viaja en `crear_bitacora_app` (`p_hubo_equipos`/`p_equipos_alquilados`) → `bitacora_equipos_alquilados`
  + alimenta `otros_valores` (U25). Visible en el detalle. **Nota:** PROMPT-9 ya había extendido el RPC;
  quité una sobrecarga redundante que dejé y unifiqué en UNA función canónica.
- **W3 paridad bitácora:** auditoría campo-por-campo (tabla abajo). Cerrado en la app: **bloque_entrepiso,
  ingeniero_responsable, hora_fin_trabajo** (parte, opcionales en el resumen), **incidente_subcontratista**
  + **incidente_acciones** (incidente), y render de todo + `created_at` en el detalle. RPC extendido
  aditivamente con esos params (los escribía el form web por insert directo; ahora la app también).
  **Deferido con razón:** tipo `visita` (flujo nuevo completo, bajo uso en campo) y `weather_snapshot`
  auto (contradice R21 — la fuente de verdad del clima es la respuesta del usuario, no el weather API);
  y export Excel/print (app de campo/offline). Flagueados para tu decisión.
- **W4 barrido visualización:** corregido lado app → **ruta.notas** (se capturaba, no se veía;
  `mis_rutas_hoy` ahora devuelve `notas`, se muestra en la tarjeta de ruta). **Lado web (SGC) — para el
  próximo prompt:** (1) GPS de entrega/recepción de vehículo (se manda `p_gps`, la web no lo modela ni
  muestra en flota/responsabilidad); (2) fotos por-ítem del checklist pre-uso (`item_N` en
  `checklist_vehiculo_fotos`, la web solo pinta los slots fijos); (3) foto de salida no-conduce
  (inventario/salidas no tiene botón 📷 como entradas).
- **W5 skeletons:** barrido app OK — toda pantalla que carga datos tiene skeleton (directo o vía
  `selector-categorias [loading]`). El "Cargando…" que queda es el botón "Cargar más" de auditoría (ok).
  **W5-web (skeletons en TODOS los módulos de SGC) = lado web, para el próximo prompt.**
- **W6 (auditoría → dashboard analítico) = lado web (SGC)**, fuera de este repo. Para el próximo prompt.
- **W7 versiones auto:** `scripts/release-apk.mjs` registra la versión vía RPC idempotente
  `registrar_version('movil', VERSION, notas)` (notas = changelog curado, editable). La publicación a
  usuarios sigue siendo manual del admin (R15). El auto-registro web es lado SGC.

**Pendiente:** device-QA del nuevo flujo (20+ fotos offline, equipos en el detalle, campos de paridad) —
requiere rebuild del APK (el device tiene 1.6.0 sin este código) o correr la PWA. Commit/push a tu OK.

---

## Actualización 3 (V1–V15) — build verde, APK 1.6.0 firmado local, NADA pusheado/publicado
Ronda de bugs de versionado/instalación, rediseño de inventario/requisición por el catálogo
oficial, skeletons, tarjetas de vehículos, reporte semanal por pool y verificación V15.
`npm run build` limpio. Bump **1.5.0 → 1.6.0** (versionCode ahora se DERIVA del nombre en Gradle:
1.6.0 → 1006000). **No commit / no push / no publicar** hasta tu OK.

**FASE 0 — bugs visibles**
- **V6/V11 (CTA invisible):** el host `<app-selector-categorias>` no tenía layout flex → el footer
  "Siguiente" se desbordaba/recortaba. Fix `:host{display:flex;flex:1;min-height:0}` + grid/list
  `min-height:0` + barra `flex:0 0 auto; position:sticky; bottom:0`. Mismo endurecido en `asignar`
  y `salida/entrada` (`.mov__nav`). El CTA de avance ya no puede quedar invisible.
- **V2 (verificar versión mentía):** en el APK el botón sólo miraba el service worker (deshabilitado
  en nativo) → siempre "ya tienes la última". Ahora `VersionService.checkFresh()` consulta
  `version_publicada()` **sin caché** y compara semver; si hay nueva → va a `/actualizar`.

**FASE 1 — rolling update + firma (V3/V4/V5)**
- **V3:** plugin nativo `ApkInstaller` (android/.../ApkInstallerPlugin.java, registrado en
  MainActivity) + `UpdaterService` (descarga el APK de `apk_url` a caché con progreso vía
  Filesystem.downloadFile, luego intent de instalación con FileProvider). Manifest:
  `REQUEST_INSTALL_PACKAGES`. Página `/actualizar` (barra de progreso, permiso "apps desconocidas",
  errores visibles). PWA: enlace de descarga directa.
- **V4:** banner tappable global "Nueva versión X.Y disponible" (`app.html`) → `/actualizar`. El gate
  bloqueante también usa el updater in-app. ⚠️ **Push OS real NO** (no hay FCM/plugin push) — la
  "notificación in-app" es el banner. Push requiere Firebase + tu config (pendiente, avísame si lo quieres).
- **V5:** keystore estable **`C:/Users/xavie/keystores/constructorasd.keystore`** (alias
  `constructorasd`), **FUERA del repo**. Es el **MISMO certificado** que produccón (era
  `csd-release.keystore` alias `csd`; sólo cambió el nombre y el alias vía `keytool -changealias`,
  cert SHA-256 idéntico `3C:53:16:D8:…:65`) → los APK nuevos instalan ENCIMA sin conflicto de firma.
  `keystore.properties` apunta ahí. versionCode auto-derivado. Script `npm run apk` (build+sync+
  gradle+verifica cert) y `npm run apk:publish`. **⚠️ RESPALDA** `constructorasd.keystore` +
  `keystore.properties` fuera de esta máquina. **Play Protect:** con firma estable + targetSdk 36 +
  manifest limpio baja el warning en updates; eliminarlo 100% sólo por Play Store (documentado).

**FASE 2 — skeletons + conteo (V7/V8)**
- **V7:** auditoría completa (agente). Arreglados los 3 huecos duros (liberacion, preuso,
  conduces/entrega mostraban "Cargando…"/no-encontrado durante la carga) + `selector-categorias`
  gana input `loading` (shimmer) usado por salida/entrada/requisición + incidente. El resto de la
  app ya tenía skeleton.
- **V8:** conteo permite guardar sin cambios → confirma "todo conforme" (el RPC ya lo soporta,
  registra "Todo conforme — sin diferencias"). Botón pasa a "Guardar (sin diferencias)".

**FASE 3 — catálogo oficial + requisición por hojas (V14/V13)**
- **V14:** artículos ahora traen `requiere_talla` + `nota`; cache offline invalidada (keys `_v2`).
  EPP con `requiere_talla` pide talla obligatoria (modal S/M/L/XL + libre) al agregar; `nota` de
  atado/paquete visible como ayuda. La talla viaja en `detalle_salidas.talla` (salida) y como
  "(Talla X)" en la descripción (requisición). Categorías en orden oficial 01→08.
- **V13:** requisición (`pedir`) reescrita con el patrón de hojas (reusa `SelectorCategorias` en
  modo `requisicion`): categorías → categoría/stepper → resumen editable (obra + urgencia) → éxito
  con **compartir por WhatsApp**. "Otros" (08) permite describir material libre (articulo_id null +
  descripción → `crear_solicitud_app`). Offline vía outbox.

**FASE 4 — vehículos + reporte semanal (V11/V10/V15)**
- **V11:** nuevo `shared/ui/vehiculo-card` (foto/placeholder + tipo·km legibles) usado en el pool de
  `asignar` (tarjeta seleccionable) y en el picker del reporte semanal.
- **V10:** reporte semanal ahora lista **todo el pool** (`getVehiculosDisponibles`), no sólo los
  asignados; cualquier conductor elige y reporta. Sin guard de asignación (el RPC tampoco lo exige).
- **V15:** corregidas las desviaciones vs las pantallas del jefe — combustible (card "km última
  echada", "Fotos obligatorias", labels "Recibo"/"Tablero (km)", texto de respaldo, "Kilometraje
  actual"); datos de salida (card con último km + "Mantenimiento cada N km · próx. X", línea PRE-CITA
  con próximo km, botón "Continuar al checklist" deshabilitado hasta km+combustible); fotos (secciones
  EXTERIOR—4 / INTERIOR—3, "Toca cada recuadro…", botón "Faltan N foto(s)").

**FASE 5 — bitácora (V12a-d): YA estaban implementados en 1.5.0**
- Verificado: **V12a** cantidad por actividad (stepper + input + plan de partida, viaja al RPC
  `crear_bitacora_app.cantidad` y se ve en el detalle), **V12b** CLIMA quitado (activo=false en DB +
  fuera del const; `getCatalogos` filtra activo), **V12c** "Describa…" obligatorio por restricción
  (guard en paso 6), **V12d** el detalle muestra fotos (galería con signed URLs) + cantidad +
  descripción. El tester los vio "sin implementar" porque **producción sigue en 1.4.0** (1.5.0 se
  compiló pero nunca se publicó). Se resuelven al publicar 1.6.0.
- ⚠️ **SGC web (regla #5):** confirmar que la web muestra cantidad por actividad + descripción de
  restricción + fotos de bitácora (las fotos ya; cantidades/descr pendiente de verificar — avísame).

**Pendiente / tu decisión:**
- Publicar 1.6.0 (`npm run apk` ya deja el APK firmado; luego `npm run apk:publish` sube al bucket y
  registra en historial — **NO lo corrí**; publicar sube `min`/oferta a los de campo).
- Device-QA: instalar 1.6.0 ENCIMA de una versión anterior (valida V5 sin desinstalar), actualizar
  desde la app (V3), salida/requisición por hojas + talla EPP + Otros, conteo conforme, reporte
  semanal desde el pool, V15, bitácora completa. Offline→reconnect en los flujos tocados.
- Respaldar el keystore. (Opcional) push OS real vía FCM para V4.

---

## Actualización 2 — cierre de gaps (auditoría contra código) — build verde, 17/17 tests, NADA commiteado
Branch **`feat/actualizacion2-movil`**. Auditamos U1–U25 contra el código real (4 agentes). U1/U8/U10/U11/U12/U13/U18/U19/U20/U21/U24 ya estaban DONE. Cerramos los gaps reales:

- **U22 (origen obra/almacén):** crear-ruta ahora tiene selector de obra/almacén también para el ORIGEN (usa sus coords), no solo destino. Botón "🏗️ Elegir una obra o almacén" + `onOrigenLugar()`.
- **U23 (duración legible):** `formatearDuracion` estaba muerto (0 usos) y no había fuente de duración. Añadido `GeocodingService.ruta()` (OSRM keyless) → crear-ruta muestra **"Tiempo estimado: 1 h 28 min"** cuando hay coords de origen+destino, y autollena km. Offline = silencioso (no bloquea).
- **U25 (entrada "Otro"):** inventario/entrada motivo "Otro" abría literal "Otro"; ahora abre campo obligatorio "Especifica de dónde viene…" y envía ese texto como `referencia` (llega al backend/web, no se pierde). ⚠️ Feed a `otros_valores` desde entrada requeriría param en el RPC `registrar_entrada_app` (scope SGC) — la bitácora sí lo hace vía `descripcion_otro`.
- **U9 (fechas es-DO):** quitado ISO crudo en preuso (matrícula/seguro vencidos → `formatFecha`) y todos los `| date` reemplazados por el util es-DO (`formatFecha`/`formatFechaMedia`/`formatFechaHumana`) en mis-partes, detalle, mi-actividad, solicitudes/mis, admin/reportes, admin/conteos, admin/auditoria.
- **U6 (foto vehículo):** `getVehiculo()` trae `foto_path`; foto en **perfil-vehículo**, header de **combustible**, **lista del reporte semanal** y **selector de vehículo de crear-ruta** (`SelectList` ahora acepta `image?` opcional y muestra thumbnail; retrocompatible). Cubre listas + selectores + perfil.
- **U4 (no perder datos / botón físico):** nuevo `NavGuardService` + listener global de `backButton` en `app.ts` (`@capacitor/app@8` instalado + `cap sync` hecho). Nueva base `shared/guarded-wizard.ts` (`GuardedWizard`): preuso/combustible/reporte-semanal/reportar ahora confirman "¿Descartar cambios?" (y combustible/preuso ganaron botón **Cancelar** en el paso 1 — antes eran dead-ends). crear-ruta/salida/entrada/bitácora-parte registran también la guarda del botón físico Android.
- **U5:** N/A — la app no tiene inputs de teléfono (util `telefono.ts` listo si se agrega alguno). **U17:** solo-web (la app no tiene módulo tecnológico).

**Device-QA hecho (device 6dbf1af4, APK v1.5.0 rebuild con `@capacitor/app`):** ✅ U4 botón
físico Android → "¿Descartar la inspección?" en preuso (Seguir aquí conserva / Sí descartar sale)
+ "¿Descartar la ruta?" y "¿Salir de la entrada?"; ✅ U22 origen por obra/almacén (BRISAS);
✅ U23 ETA OSRM "5 min" + km autollenado (BRISAS→Torre Alpha); ✅ U6 thumbnail del vehículo en el
selector de crear-ruta; ✅ U25 "Otro" en entrada revela "Especifica de dónde viene…". No pude
seguir tras el re-lock por PIN (device-only).

**BUG pre-existente encontrado y arreglado (footer overflow):** los botones globales `.btn-cta`/
`.btn-ghost` traen `width:100%`; en los footers `[Atrás][Primario]` cuyo back usa `flex: 0 0 auto`
(sin encoger), el back acaparaba el ancho y el **botón primario colapsaba a ~0px (intappable)**.
Confirmado con uiautomator (selcat "Siguiente" 0×0 → tras fix [726,1035]; submit de entrada 17px).
Fix `width:auto` en: `selector-categorias` (Siguiente/Cancelar), `crear-ruta`, `reporte-semanal`,
`salida`/`entrada` (resumen), `liberacion`, `asignar`. preuso/combustible/parte ya se salvaban con
`max-width:120`. **Esto afectaba flujos core (completar salida/entrada, crear ruta, reporte semanal,
liberación) en pantallas ~1080px** — verificar en la web SGC si comparte el patrón.

**Device-QA COMPLETO (con PIN):** además de lo anterior, verificado en device ✅ U6 foto del Amarok
en header de combustible y en el **perfil del vehículo** (perfil muestra foto + stats, "Asignados 2"
= pool U1); ✅ U9 fechas humanas en Mis requisiciones ("13 jul 2026", "8 jul 2026"); ✅ fix del footer
(botón Siguiente/guardar ya no colapsa). Todo U1–U25 verificado en teléfono o por build+review.

**Estado final:** `feat/actualizacion2-gaps` **mergeada a `main` y pusheada** → PWA auto-deploy a
Vercel. APK v1.5.0 (rebuild con `@capacitor/app`) instalado al device, **sin publicar al bucket**
(publicar con `node scripts/release-apk.mjs` solo con tu OK — forzaría min_version a los usuarios).

---

## Actualización 2 móvil (PROMPT-6) — build verde, SQL aplicado, NADA pusheado
Branch **`feat/actualizacion2-movil`** (commit local `fb15068`, no pusheado). Delta de
actualización 2 sobre la app de campo. `npm run build` verde. Falta device-QA + (si se aprueba)
push PWA + bump/APK.

**F1 flota:** U10 pre-uso ahora filtra `frecuencia='preuso'` (nunca la de 33 ítems ni la semanal)
+ clave de caché nueva (`checklist_plantillas_preuso`) que invalida cachés viejos; U8 texto que
explica reporte-semanal vs pre-uso en el hub; U6 foto del vehículo en el selector del pool
(`asignar`, URL firmada bucket `vehiculos`); U1 el pool ya era accesible vía "Asignarme un vehículo".

**F3 bitácora:** U11 quitado 'CLIMA' del catálogo de restricciones; U12 "Describa…" obligatorio por
restricción (envía `descripcion_otro`; RPC ya lo aceptaba); U13 el detalle muestra clima, migración
(obreros) y cantidad por actividad (modelo + select extendidos).

**F2 rutas (sin mapa embebido):** **bug corregido** — las coords de origen se perdían;
`crear_ruta_app` extendido aditivo con `p_origen_lat/lng` (`sql/2026-07-15-crear-ruta-origen-coords.sql`,
aplicado a prod) y el handler las envía; U22 destino por **obra o almacén con sus coordenadas**
(`getLugaresDestino`); U21 botón "usar mi ubicación actual" con permiso nativo + error visible.

**Utilidades (paridad):** `core/util/fecha.ts` (U9 — las fechas ya no eran ISO cruda, usan DatePipe),
`duracion.ts` (U23 — sin fuente de duración aún), `telefono.ts` (U5 — la app no tiene inputs de teléfono).
**U25:** la restricción "OTRO" ahora manda `descripcion_otro` → el trigger de BD la registra en
`otros_valores` (web y móvil), sin cambio de app extra. **U17** (inventario/compras tec) = solo web
(la app no tiene módulo Tecnología).

**F2 mapa interactivo (U18/U19/U20) — HECHO, pendiente walk-through en teléfono:** nuevo
`shared/ui/location-picker` (Leaflet 1.9.4 + OSM): pin por toque, búsqueda RD (Nominatim
`countrycodes=do`, es), "usar mi ubicación actual" (Geolocation nativo + permiso + error visible),
`invalidateSize` para el WebView. `GeocodingService`. Rutas: origen con mapa (toggle) y destino "En
el mapa" además de obra/almacén; coords guardadas. U4 confirmación de descarte en crear-ruta.
Leaflet CSS en angular.json; pin del marcador en styles.scss.

**APK v1.5.0 / versionCode 18:** bump en build.gradle + environments + release-apk.mjs; `npx cap sync`
hecho; **APK release firmado construido e instalado al device 6dbf1af4** (arranca OK, sin crash en
logcat). **NO publicado al bucket** (release-apk.mjs pone `min_version=VERSION` → forzaría a los
usuarios de campo; publicar solo con tu OK).

**Pendiente:** walk-through en el teléfono (mapa: pin/búsqueda/ubicación/obra-almacén; pre-uso 10
tópicos; reporte semanal; bitácora describa+detalle; offline→reconnect). U4 "descartar" en el resto
de wizards (preuso/combustible usan pasos con "Atrás"; falta interceptar el botón físico — es
transversal). U24 fino: los perfiles/dashboards/gestión de avisos quedan solo-web (admin), lo
operativo del chofer está en la app. **Nada pusheado** (branch local `feat/actualizacion2-movil`).

---


## Historial de versiones (timeline admin) — ✅ en prod
Página **solo admin** `admin/versiones` (`moduleGuard('admin')`): línea de tiempo con tabs
App móvil / Web, cada versión con fecha + cambios. Lee `sgc.app_versiones` (extendida en SGC:
`plataforma`/`fecha`/`titulo`/`cambios`; seed histórico curado). `VersionService.historial()` +
tile en el hub admin + ruta. Espeja la web SGC (`admin/historial-versiones`). Build verde.
La 1.4.0 móvil ya está en la tabla (preparada, sin publicar — publícala desde SGC → app-versiones).

## Actualización 1 (14/07 tarde) — Inventario por HOJAS + Reporte semanal v2 — ✅ en producción
`npm run build` limpio. **Commiteado y pusheado a `main`** (merge `97a72f3` `feat/inventario-hojas`) → PWA desplegado a prod (Vercel `csd-app`, deploy `dpl_9JtVX4…` READY). El APK aún requiere bump/firma/publicación manual (no automatizable aquí).
**Refinamiento (esta sesión):** el wizard del reporte semanal ahora **agrupa las preguntas por sección** (encabezados oficiales del papel §B) — antes era lista plana. Cambio solo de UI (`reporte-semanal` .ts/.html/.scss), build verde.
**Bump + release 1.4.0 (esta sesión):** `1.3.2`→**`1.4.0`** / versionCode 16→**17** en `android/app/build.gradle`, `src/environments/*`, `scripts/release-apk.mjs`. PWA en prod. **APK nativo COMPILADO, FIRMADO y PUBLICADO** (el entorno estaba completo: JBR JDK + SDK + keystore): `gradlew assembleRelease` → `apksigner verify` OK (v2, 1 firmante) → `node scripts/release-apk.mjs` subió `csd-app-1.4.0.apk` (8.2 MB) + `csd-app-latest.apk` + `version.json` al bucket `app-releases`. La página **CSD App (móvil)** de SGC ya ofrece la descarga (HTTP 200).
⚠️ Esto solo hace el APK **descargable**. Qué versión se OFRECE/EXIGE a los usuarios de campo sigue controlado por el admin en SGC → app-versiones (R15): la fila `movil 1.4.0` está en `app_versiones` **sin publicar** (publicada/minima = false), así que nadie se ve forzado hasta que la publiques.

**Fase 1 — Inventario navegación por "HOJAS" (rediseño UX de salida/entrada):**
- Nuevo componente reutilizable `shared/ui/selector-categorias` (patrón hojas): hoja de categorías (destacadas primero, badge con # seleccionados por categoría, barra fija con total del carrito + Siguiente) → hoja de una categoría (solo sus artículos, buscador interno, stepper −/+, "Listo" vuelve conservando el carrito). Cart como `model()` de dos vías (lo posee la página, sobrevive a la navegación).
- `salida` y `entrada` reescritas como máquina de hojas: selección → **resumen** (agrupado por categoría, editar stepper/quitar, almacén + nota/motivo, foto opcional) → **éxito** ("Completado con éxito" + **Compartir por WhatsApp** el resumen + "Nuevo registro"). Atrás/cancelar en cada hoja con confirmación si hay carrito.
- `core/util/share.ts` (`compartirTexto` — @capacitor/share nativo / Web Share PWA / fallback a portapapeles). Sin cambios de BD (items multi-categoría ya iban en un jsonb; la categoría es solo agrupación UI).
- `ArticuloPicker` sigue existiendo para pedir/conteo (no tocados).

**Fase 2 — Reporte semanal plantilla v2 (PROMPT-3):** backend ya tiene `REPORTE-SEMANAL-V2` activa (9 ítems oficiales del papel) y V1 desactivada; el wizard la consume dinámicamente. Se **quitó el selector de combustible** (no estaba en prod; §B lo pide); km se mantiene; ítem 10 = comentario opcional (campo observación). La confirmación refleja hallazgos si hubo algún "NO".

**Pendiente:** device-QA del flujo de hojas (multi-categoría, editar en resumen, compartir con/sin share nativo, offline) + reporte semanal v2. Bump/APK. Commit/push cuando lo apruebes.

---


## Mejoras 14/07/2026 (reunión jefe — R1–R29) — build green, 17/17 tests, backend aplicado 🚧 falta device-QA
Implementadas 8 fases sobre Flota v2. `npm run build` limpio y `ng test` 17/17. Migraciones aplicadas a la BD prod compartida (`node scripts/apply-migration.mjs`).

**Backend nuevo aplicado desde este repo (`sql/`):**
- `2026-07-14-crear-ruta-app.sql` — RPC `crear_ruta_app` (idempotente, gate flota, homologa origen/destino).
- `2026-07-14-reportes-fotos.sql` — bucket `reportes` (+RLS), tabla `reportes_usuario_fotos`, `crear_reporte_app` extendido con `p_fotos` (se dropeó la sobrecarga vieja de 4 args para evitar ambigüedad PostgREST).
- `2026-07-14-bitacora-clima-migracion.sql` — `crear_bitacora_app` extendido con `p_llovio/p_lluvia_detalle/p_hubo_migracion/p_migracion_obreros` + inserta `cantidad` de actividades. Retrocompatible (params con default).
- (PROMPT-1 ya estaba: `vehiculo_asignaciones`, `asignarme_vehiculo`, `auto_registrar_conductor`, plantilla `REPORTE-SEMANAL-V1`, vistas `v_vehiculo_stats`/`v_conductor_stats`/`v_reporte_semanal_cumplimiento`, `categorias_inventario.destacada`, `articulos.categoria_id`, `proyecto_partidas`, `app_versiones`+`version_publicada()`, triggers de homologación.)

**App (por fase):**
- **F1 (R1/R2/R11):** Transporte con `EmptyState` + CTA "Asignarme un vehículo"; wizard `transporte/asignar` (lista disponibles → auto-registro conductor si falta → `asignarme_vehiculo` → encadena a recibimiento). "Asignados a mí" lee `vehiculo_asignaciones`. Nuevo `shared/ui/empty-state`.
- **F2 (R3):** `transporte/reporte-semanal` (plantilla semanal, OK/NO/NA + combustible + km + obs; badge de pendientes; "ya enviaste esta semana"). `ReporteSemanalService` → `registrar_checklist_vehiculo` (tipo `inspeccion`, la vista detecta por `frecuencia='semanal'`).
- **F3 (R7):** `transporte/rutas/crear` (espeja creación web de rutas; offline outbox `crear_ruta`). Combustible v2 verificado operativo.
- **F4 (R10):** `@aparajita/capacitor-biometric-auth@10` (Cap 8). `BiometricService`, toggle en Perfil (solo si soporta, oculto en PWA), botón "Usar huella" en pin-unlock; PIN sigue siendo fallback. `npx cap sync android` hecho.
- **F5 (R11/R13/R14):** `EmptyState` en Mis conduces/Mis bitácoras/Mis requisiciones/Recibir/Home-sin-módulos. Bitácora parte: topbar ← + Cancelar + confirmación de salida. Reportar: fotos (`PhotoSlot`→bucket `reportes`). ⚠️ **falta que la web SGC muestre las fotos de reportes** (rule #5).
- **F6 (R12/R16/R17/R18):** `ArticuloPicker` por categorías (destacadas primero, fallback plano en pedir/conteo); stepper −/+ en salida/entrada; `inventario/almacenes` (CRUD, gate inventario); homologación front (`core/util/texto.ts`) + trigger BD.
- **F7 (R21–R24):** wizard bitácora reordenado a 8 pasos (obra→lluvia→migración→personal→actividades c/cantidad+plan→problemas→fotos→resumen); incidente descripción obligatoria.
- **F8 (R4/R5/R15/R26):** `transporte/vehiculo/:id` (v_vehiculo_stats) y `transporte/mi-actividad` (v_conductor_stats); `VersionService` + gate bloqueante si local<mínima + aviso versión nueva + Perfil muestra versión publicada; home ya gatea tiles por módulo (R26).

**Pendiente (necesita Xaviel / no automatizable):**
- Device-QA: auto-asignación→auto-registro→recibimiento, reporte semanal, crear ruta, biometría+fallback PIN, bitácora atrás+lluvia/migración/cantidades, reporte con fotos, inventario por categorías+stepper, gestión almacenes, gate de versión. Offline→reconnect en los flujos nuevos.
- **SGC web:** mostrar fotos de reportes de usuario (R14) y verificar que renderiza lluvia/migración/cantidades/incidente_descripcion (R21–R24). Marcar `categorias_inventario.destacada` para Clavos/Madera (hoy solo Acero) — §5 pendiente de confirmar.
- Bump de versión + build/firmar APK + publicar (`scripts/build-apk.md`, `release-apk.mjs`); `npx cap sync android` antes de compilar. No se hizo commit/push.

---


_Last updated: 2026-07-13 (Flota v2 — Combustible + Pre-uso v2)_

## Flota v2 — Combustible (nuevo) + Pre-uso v2 (branch `fix/mobile-responsive`) — build green, APK on device 🚧 falta walk-through con login
Backend Fase 0 ya estaba aplicado en `sgc` (verificado contra la BD, no re-hecho): RPC `registrar_combustible_app` (jsonb con derivados), `registrar_checklist_vehiculo` extendido con `p_nivel_combustible` (calcula `resultado`/`alerta_mantenimiento`/bloqueos server-side), columnas nuevas en `vehiculos`/`conductores`/`registros_combustible`/`checklists_vehiculo`, tabla `avisos_flota`, catálogo v2 (plantilla `PRE-USO-V2`, 33 ítems, `numero`/`aplica_a`/`es_critico`), `flota_config` (umbral_consumo_pct=20, umbral_precita_km=500, umbral_licencia_dias=30).

**FASE 1 — Combustible** (`pages/transporte/combustible/:vehiculoId`, botón ⛽ en el hub):
- `core/models/combustible.model.ts` (`calcularCombustible()` — espejo exacto del RPC), `core/services/combustible.service.ts` (`getUltimaEchada()` cacheado por vehículo + `registrar()` → outbox `tipo_op:'combustible'` → handler sube 2 fotos a `vehiculos` en `combustible/{uuid}/{recibo|tablero}.jpg`, upsert idempotente, RPC con paths).
- Wizard 3 pantallas: datos (km valida >última echada, galones, monto, estación) + caja oscura de cálculo en vivo → 2 fotos obligatorias ("Faltan fotos para guardar") → confirmación "Combustible registrado" con tarjetas + banda verde/ámbar (offline: cálculo local + "se validará al sincronizar").

**FASE 2 — Pre-uso v2** (reescrito `pages/transporte/preuso/`):
- `ConductoresService` nuevo (`getMiConductor()` por `usuario_id=auth.uid()`, cacheado) + `conductor.model.ts` (`estadoLicencia`). `VehiculosService.getVehiculoDetalle()` (vencimientos + km mantenimiento, cacheado).
- Bloqueos previos: licencia vencida / matrícula / seguro vencidos → pantalla de bloqueo; licencia ≤30 días → banner. **Ahora envía `p_conductor_id` real** (antes null).
- Pasos: datos de salida (km valida ≥ odómetro + nivel combustible + línea de mantenimiento en vivo ok/pre-cita/vencido) → checklist v2 (ítems por `aplica_a`, "Herramienta Pesado" solo si `tipo` es pesado — pickup=liviano, oculta; críticos "CRÍTICO · BLOQUEA"; barra semáforo n/total) → 7 fotos guiadas (slots `delantera,lateral_izq,lateral_der,trasera,tablero,interior_del,parte_trasera`) → firma → veredicto tri-estado.
- **PDF + compartir**: `PreusoReportService` (jsPDF — header oscuro, datos, banda de resultado, hallazgos, página de evidencia) → `@capacitor/share` nativo (Filesystem cache) / Web Share API en PWA / fallback descarga.
- Deps nuevas: `jspdf@4`, `@capacitor/share@8` (`npx cap sync android` hecho — Share registrado). `angular.json`: `allowedCommonJsDependencies` (jspdf/canvg/core-js/raf/rgbcolor).

**Verificación:**
- `npm run build` limpio (0 errores/0 warnings). 17 tests verdes (`core/models/flota-calculos.spec.ts`: cálculo combustible, licencia, pesado/aplicabilidad).
- Web SGC (`dev/SGC`) **ya tiene** todo el lado de visualización y **lee exactamente lo que la app escribe** (verificado column/path/slot): `/flota/combustible` (echadas), `/flota/combustible-dashboard` (acumulado + panel flotilla), `/flota/checklists` (inspecciones con resultado/7 fotos/hallazgos), `/flota/panel-dia`, `/flota/avisos` (gestión avisos_flota). Nada que construir en web.
- **APK debug instalado en device `6dbf1af4` (Redmi Note 10)** y arranca OK (login renderiza, sin crash). ⚠️ Se desinstaló la app de producción (firma release ≠ debug keystore; autorizado por Xaviel) — la sesión/PIN/cola offline previas se perdieron. Para volver a producción: reinstalar desde la página de descarga.

**Datos de prueba configurados (BD prod compartida):** `TEST-0000` → `responsable_id`=Xaviel (aparece en "Por recibir"), matrícula/seguro=2026-12-31 (vigentes), `km_ultimo_mantenimiento`=6000, intervalo=5000, odómetro=10000 (a 10.000 faltan 1.000=normal; teclear ~10.600→pre-cita, ~11.200→vencido). Conductor "TEST Conductor Prueba" ligado a `tecnologia@` (licencia vigente 2027-09-16, Ambos). El vehículo real `AB2890340` NO se tocó.

**Pendiente (necesita Xaviel — no automatizable):** walk-through en el teléfono con tu contraseña + PIN + cámara: combustible (primera echada / normal / km inválido), pre-uso (aprobado/hallazgos/bloqueado, pre-cita), PDF compartir, offline→reconnect. Luego confirmar en la web (`/flota/*`). Para probar bloqueo por licencia/matrícula: poner una fecha pasada en el conductor/vehículo de prueba. **No se hizo commit/push** (a la espera de tu OK).

---

_Last updated: 2026-07-12 (v1.2.0)_

## v1.2.0 — mantenimiento + rutas "cómo llegar" (para el piloto)
- **Reportar mantenimiento** (Transporte → por vehículo): tipo/descr/km/fotos, offline-outbox → RPC `crear_mantenimiento_app` (idempotente). Servicio `core/services/mantenimientos.service.ts` (registrado en app.config), página `pages/transporte/mantenimiento/:vehiculoId`.
- **Rutas de hoy → "Cómo llegar"**: abre la app de mapas del teléfono al destino.
- (Parte B previa: renames Requisición/Almacén + checklist pre-uso, ya en prod.)
- Bump **v1.2.0 / versionCode 11**. APK firmado se construye con `scripts/build-apk.md` (JAVA_HOME=Android Studio jbr, `./gradlew.bat assembleRelease`), `adb install -r`, y `node scripts/release-apk.mjs` publica APK+version.json al bucket app-releases.


## Reunión 07/07/2026 — Parte B (branch `feat/meet-07072026`, build green) 🚧 pendiente device-QA + publish
Mobile side of the 07/07 meeting. DB is shared with SGC web; RPCs already exist there.
- **Renombres UI** (solo labels): "Solicitudes/Pedir materiales" → **Requisición/Nueva requisición** (home tile, hub, pedir, mis); "Bodega" → **Almacén** (existencias/salida/entrada/conteo). Estados de requisición SIN cambio (la app ya conoce pendiente/aprobada/entregada/rechazada; NO exponer compras/montos al chofer).
- **Checklist de pre-uso vehicular** (nuevo): `pages/transporte/preuso/:vehiculoId` — wizard plantilla → ítems OK/Falla/N-A por sección (marca crítico + foto en NO) → km/obs → firma → resumen. Servicio `checklist-preuso.service` mirror de `vehiculos.service` (outbox offline, idempotente por UUID) → RPC `registrar_checklist_vehiculo` (ya existe en `sgc`). Handler registrado en `app.config`. Botón en el hub de Transporte.
- **NO** se agregó nada de cuadres/límites/alertas/montos ni Tecnología/Expediente (prohibido para campo).
- **Pendiente:** device-QA (offline + online), y **bump de versión + build/publish del APK** (paso de Xaviel — requiere dispositivo). No se subió versión aún.

_Last updated: 2026-07-11 (below)_

## v1.1.3 — interactive spotlight tour (both systems), device-verified + published ✅
The first-run guide now **shows** instead of only telling: it dims the screen and spotlights each real UI element as it explains it.
- **Web (SGC)**: `onboarding-web` rewritten as a tour — welcome → sidebar → pending badges → CSD App link → Soporte → profile → done. Anchored via `data-tour` attrs + `tourKey()` in the shell. Replayable from Soporte ("Ver la guía de bienvenida"). Browser-verified (rings the real sidebar / each nav item; centered fallback when a target is absent).
- **App (CSD)**: `shared/components/onboarding` rewritten as a spotlight tour on Home — welcome → tiles → sync bar (verde/amarillo) → profile → done. Anchored via `data-tour` on the grid, `<app-sync-bar>`, and the Perfil button. Replay from "Soporte y ayuda". **Device-verified** end-to-end (v1.1.3): each element ringed in orange, callout positioned above/below, dismisses clean.
- Same spotlight technique both sides (box-shadow dim + measured getBoundingClientRect + on-resize re-measure). **Published v1.1.3** (code 10).


## v1.1.2 round — skeletons, sign-out confirm, full audit trail (both systems) ✅
- **Audit trail (traceability)** — `sql/2026-07-11-auditoria.sql`: `sgc.auditoria` + a generic `fn_auditoria()` AFTER trigger attached to **55 business tables**. Captures every INSERT/UPDATE/DELETE with the real actor (`auth.uid()`), a before→after diff (UPDATE), and the row (INSERT/DELETE). DB-level ⇒ catches **web AND app** writes automatically (app RPCs are SECURITY DEFINER but keep the caller's JWT). RLS: readable by `is_admin() or tiene_modulo('auditoria')`. `auditoria_actores()` RPC feeds the user filter. Verified non-destructively (trigger logs exact diff + actor, rolls back).
  - **Web viewer**: SGC Admin → Auditoría (`pages/admin/auditoria`, `auditoria.service`) — filter by usuario/área/acción/fecha + search, server-side `.range()` pagination, expandable diffs. Device/browser-verified.
  - **App viewer**: CSD Admin → Auditoría (`pages/admin/auditoria`, `AdminService.getAuditoria`) — filter chips + load-more + expandable diffs. Device-verified (caught a real "Modificó Catálogo · Activo Sí→No" by Xaviel).
- **Skeleton loaders** — SGC `shared/components/skeleton` (table/list/cards) on 8 main list pages; CSD `shared/ui/skeleton` on all data screens (transporte, conduces, existencias, conteo, recibir, mis-solicitudes, mis-partes, detalle, admin/*). Replaces blank pages / bare "Cargando…".
- **Sign-out confirmation** — SGC `shared/components/confirm-dialog` on the header logout; CSD `shared/ui/confirm-dialog` on Perfil → Cerrar sesión. Both device/browser-verified.
- **Published**: versionCode 9 / **v1.1.2**. Both repos pushed; SGC → Vercel.
- Note: audit `sgc.auditoria` starts empty and fills with real activity going forward (synthetic demo rows were purged).


## Web parity round — conduce evidence tested + all app media now visible in web ✅
Rule reinforced: the app is a **child of the web** — anything captured on the app must be viewable in SGC. Audited every app write; closed the media gaps. All verified in a real browser (Edge headless, session minted via admin magic-link OTP + localStorage injection against the SGC dev server):
- **Conduce delivery evidence** — seeded real photo+firma into the `conduces` bucket, confirmed the SGC conduce view renders "Recibido en obra por / Entrega registrada por {chofer}" + the delivery photo & signature. Test data reverted.
- **Web first-run guide** — `SGC/src/shared/components/onboarding-web` (5 slides, skippable "Saltar guía"). Shows once for **non-admin** users on first shell load; **admins skipped** (marked done silently). Flag `sgc_onboarding_v1_done` in localStorage. Verified showing+dismissing for non-admin "Test User 3".
- **Vehicle signature** (`vehiculo_entregas.firma_url`, bucket `vehiculos`) — now signed+rendered in Flota → Responsabilidad. (No prod rows yet to screenshot; compiled + same pattern as the 6 photos already shown.)
- **Bitácora media** — historial detail now renders field photos inline (thumbnails) and incident voice notes with an `<audio>` player (were text links). Verified: 2 inline photos + audio player.
- **Inventario salida/entrada photo** (`foto_path`, bucket `inventario`) — salida capture photo added to the conduce view; entradas list gains a Foto column with a 📷 button (signed URL). Verified entrada foto button.
- Testing note: `msedge` + `playwright-core` + `admin.generateLink({type:'magiclink'})`→`verifyOtp`→inject `sb-<ref>-auth-token` is a repeatable way to screenshot authed SGC pages headlessly. Installed/removed per-test; not committed.


## v1.1.1 round — portrait lock, onboarding, conduce evidence in web (device-verified) ✅
- **Portrait lock**: `MainActivity android:screenOrientation="portrait"` — fixes the landscape PIN-pad overflow (keys 7/8/9/0 off-screen). Verified on device.
- **First-run onboarding**: `shared/components/onboarding` — 4 skippable full-screen slides (sin señal / fotos+firma / barra de estado) shown once on Home; flag `csd_onboarding_v1_done` in LocalStore. "Ver tutorial de nuevo" button in Soporte replays it. Device-verified end-to-end (slides → Empezar → dismiss → stays dismissed).
- **On-device smoke test** (v1.1.x, device 6dbf1af4): Admin hub (4 tiles) ✓, Catálogos add+desactivar against live DB ✓, Perfil (Admin badge) ✓, Soporte FAQ ✓.
- **SGC web gap closed** (keep-both-in-sync): the app closes conduces with a delivery photo + receiver + signature via `sgc.entregar_conduce`. The web conduce view (`pages/inventario/conduce`) now shows *Recibido en obra por*, *Entrega registrada … por {chofer}*, and renders the delivery photo + signature via signed URLs from the private `conduces` bucket. Model + `salidas.service` SELECT extended with `entregado:usuarios!..entregado_por_fkey(nombre)`. Committed+pushed to SGC `main` (Vercel auto-deploy).
- **Published**: versionCode 8 / **v1.1.1** built, signed, uploaded to `app-releases` (apk + latest + version.json). csd-app `main` pushed.


## Where we are
**M1 (Fundaciones) DONE. M2 (Transporte) — vehicle-responsibility checklist DONE.** Build passes (156 kB initial transfer). Pushed to `origin/main`.

M2 backend applied to prod + verified non-destructively (RPC enforces auth, `flota` module, the 6 required photos, and the "one responsible" rule; happy path inserts custody + updates vehicle; rolled-back test left 0 rows):
- `sgc.vehiculo_entregas` / `_fotos` / `_danos` (append-only, RLS read-only, unique-partial index)
- RPCs `crear_entrega_vehiculo` (idempotent), `vehiculo_estado_actual`, `mis_pendientes_transporte`
- Storage buckets `vehiculos`, `conduces`
Frontend: Transporte hub (a cargo / por recibir) + 6-step checklist wizard (6 guided photos → km+combustible → daños → firma → resumen), enqueued offline via the `vehiculo_entrega` sync handler (registered at bootstrap).

## Done
- **Scaffold**: Angular 21 (standalone, zoneless) + Capacitor 8 + Angular PWA (service worker + manifest). Android platform added under `android/`.
- **Env**: `src/environments/*` point at the SGC Supabase project (same anon key). Prod file-replacement wired in `angular.json`. Secrets in gitignored `.env.local`.
- **Design system** (`shared/ui`): big-button, option-button, counter, photo-slot (Capacitor camera + web fallback, JPEG compression), step-bar, big-confirm (haptic), signature-pad, sync-badge, pin-pad. Tokens in `styles.scss` (UI/UX doc).
- **Core**: SupabaseService (Preferences-backed session on native), AuthService, PinService (PBKDF2 hash, 5-try lockout), LocalStore, UserContextService (roles→módulos, mirrors SGC), SessionService (boot flow), NetworkService (signal), CameraService, ToastService.
- **Offline engine**: Dexie DB (`core/db/app-db.ts`), CatalogService (read-through cache + storage.persist), SyncService (outbox FIFO, photo→RPC, backoff 30s→5min×6, pending/syncing/done/error, client-UUID idempotency, handler registry).
- **Guards**: authGuard → pinGuard → moduleGuard.
- **Pages**: login, reset, set-password, pin-setup, pin-unlock, home (4 tiles gated by módulos, single-módulo auto-enter), module placeholders (bitácora/transporte/inventario/solicitudes), 403. Global SyncBar + ToastHost.

## Migrations — SOLVED
DDL works via the Management API using the system env var `SUPABASE_ACCESS_TOKEN` (sbp_…, already set on this machine). Use `node scripts/apply-migration.mjs sql/<file>.sql` — runs as postgres. `v_app_mi_contexto` view applied + verified on 2026-07-08. This is the path for M2's `vehiculo_entregas` tables + RPCs.

## Blockers / needs Xavier
1. **Live login walk-through** — needs a real SGC user's password to test login→PIN→home end-to-end. Build/serve/data-shape all verified; the interactive auth path is the one thing I can't self-test.
2. **Android APK** — no JDK/Android SDK on this machine. `android/` project is ready; installing JDK 21 + Android Studio lets us build/sign the first APK + keystore.
3. **Rotate keys** — service_role/secret + other keys passed through chat; rotate after the milestone.

## SGC web — Flota "Responsabilidad" view DONE (needs your commit/push)
Added in `dev/SGC` (builds clean): route `/flota/responsabilidad`, shell nav entry, `VehiculosService.getResponsabilidad()` + `getEntregaFotoUrl()`, and the `Responsabilidad` component (history list, "requieren revisión" filter, expandable photos/signature via signed URLs, damage highlighting). **Not committed** — SGC pushes deploy to Vercel prod, so left for you to review + push.

## M2 conduces — DONE
- Migration `2026-07-08e-conduces.sql` applied: `conductores.usuario_id` FK; delivery-evidence columns on `salidas_inventario`; RPCs `entregar_conduce` (idempotent, reuses despachado→entregado/incompleto), `mis_conduces_hoy`, `mis_rutas_hoy`, `marcar_ruta_estado`. Guard paths verified.
- App: `ConducesService` (+ `conduce_entrega` sync handler, registered at bootstrap); Transporte hub → "Mis conduces y rutas" → conduces list (routes with iniciar/completar + conduces) → delivery flow (photo → ¿llegó todo? → partial qty → receiver + signature), offline-first.
- SGC web (`dev/SGC`, uncommitted): Conductores form now links a driver to an app user (`usuario_id`) so `mis_conduces_hoy`/`mis_rutas_hoy` resolve. Builds clean.

## SGC web pending YOUR commit/push (deploys to Vercel prod)
`dev/SGC` has uncommitted changes for both M2 features (Flota "Responsabilidad" view + Conductores user-link):
`git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" status`

## Still needs Xavier
1. Live walk-throughs (need a real user password): vehicle checklist + conduce delivery, offline→reconnect→verify in Supabase. For conduces, first link a conductor to a user in SGC and dispatch a salida.
2. Real notifications on `requiere_revision` (no `sgc.notificaciones` table found — locate SGC's mechanism).

## M3 — Bitácora DONE
- Migration `2026-07-08f`: idempotent `sgc.crear_bitacora_app(p_id, …)` (module gate, actividades/restricciones/fotos, usuario_id = auth.uid()). Verified non-destructively (parte_diario inserts header + child rows; module gate rejects non-bitacora users). Photos reuse the existing `sgc-bitacora` bucket. Catalog enums pulled from the real CHECK constraints (estructuras/actividades/restricciones).
- App: `BitacoraService` (+ `bitacora` sync handler at bootstrap); Bitácora hub → parte-diario wizard (obra → personal counters → actividades → problemas → fotos → resumen), incidente short flow (tipo → gravedad → heridos → fotos → nota), and offline "Mis partes" list.

## M4 — Inventario + Solicitudes DONE
- Migration `2026-07-08g`: idempotent app RPCs `registrar_salida_app` (validates stock, fires trg_detalle_salidas_stock), `registrar_entrada_app` (fires detalle_entradas_stock_trigger), `crear_solicitud_app`; `foto_path` columns + `inventario` bucket. Verified non-destructively (entrada bumps stock, solicitud creates pendiente/urgente, salida guard rejects over-stock, 0 rows left).
- App: `InventarioService` + `SolicitudesService` (handlers at bootstrap). Inventario hub → existencias (bodega + search), salida (cart + optional photo), entrada (cart + referencia + photo). Solicitudes hub → pedir (cart + urgencia) + mis solicitudes (status list).

## Milestone status — all feature milestones built
M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅. M5 is piloto/rollout (no app code). The 4 Home modules are all functional end-to-end offline.

## PWA — DEPLOYED ✅
Live at **https://app.sgcconstructorasd.com** (Vercel project `csd-app`, team CSD; GitHub repo connected → push to `main` auto-deploys). `vercel.json` = SPA rewrites + `no-cache` on ngsw-worker.js/ngsw.json/index.html. Verified live: deep-link routes 200, SW no-cache. PWA auto-update wired (UpdateService: VERSION_READY → activate + reload). Perfil screen shows app version (1.0.0) + manual "Buscar actualización" + logout.

## Signed APK — BUILT & PUBLISHED ✅
Android Studio (JDK 21 + SDK) is installed, so the APK builds locally. Release
keystore `android/csd-release.keystore` + `android/keystore.properties`
(gitignored — **BACK THESE UP**; losing them = users reinstall). Signed
`app-release.apk` (7.4 MB, V2-signed) published to the public `app-releases`
bucket + `version.json`. Build/release steps: `scripts/build-apk.md`,
`scripts/release-apk.mjs`. SGC page **CSD App (móvil)** shows APK link + QR + PWA
install. Rebuild: `npx cap sync android && cd android && ./gradlew assembleRelease`
(set JAVA_HOME + ANDROID_HOME per build-apk.md).

## Authenticated E2E — VERIFIED ✅
Real anon-key sign-in → JWT → v_app_mi_contexto (módulos) + mis_pendientes_transporte
+ stock reads all work under RLS (throwaway user, deleted after). Only the on-device
camera/airplane-mode UI walkthrough still needs a physical phone.

## Done this round
Recepción de conduce en bodega (recibir_conduce_app), voice notes (incidente),
offline drafts (parte), solicitud email notification (badge interconnection is
automatic). SGC Flota view + conductor link + APK download page pushed to prod.

## v1.0.1 UX round (device-verified) ✅
Custom CSD icon (adaptive), redesigned PIN pad (device screenshot confirms), "parte"→"bitácora" copy, Mis bitácoras server list + detail (fotos/audio signed URLs), actividades multi-select (estructura×actividad), incidente obra selector fixed + voice note, browsable **ArticuloPicker** (select instead of search) in pedir/salida/entrada, entrada "Referencia"→"¿De dónde viene?" chips, `replaceUrl` on finish (back no longer re-enters filled wizard). v1.0.1/code 2 built, published, installed on device 6dbf1af4.

**Play Protect:** the "unknown developer" prompt is inherent to sideloading (targetSdk 36, signed, minimal perms — already optimal). "Install anyway" is expected/safe; only Play/Managed Google Play removes it.

**On-device deep test blocked on the local PIN** — give me the 4-digit PIN (or a test user's password) and I can drive the full flow via adb + screenshots to hunt bugs. Role gating is verified: Home tiles + routes are filtered by roles.modulos (a chofer sees only Transporte; an all-módulos user sees all — that's correct).

## Done (v1.0.3)
- **Conteo rápido**: `conteos_inventario`/`conteo_items` audit tables + idempotent
  `registrar_conteo_app` (adjusts stock to counted value via adjust_stock). Inventario flow.
- **Incident email alerts**: `notificar-incidente` edge function (deployed) → admin + proyectos
  module holders; app invokes it on incident sync. No-ops if Resend key unset.
- On-device walkthrough done (see v1.0.1/1.0.2 notes); PIN re-lock on resume fixed.

## v1.0.4 (this round)
- **Keystore backed up** to `Projects documentations/CSD App Documentation/KEYSTORE-BACKUP/` (+ LEEME.txt). ⚠️ Still copy it OFF this machine (password manager / cloud / USB).
- **Incident emails enabled/confirmed**: Vault Resend key present, function deployed, recipients = 1 admin + 5 proyectos. Fires on the first real field incident (didn't send a fake test blast).
- **UX**: native obra/bodega dropdowns → tappable `SelectList` (glove-friendly) across pedir/salida/entrada/conteo/existencias.
- **Security**: deactivated-user lockout (cold start + resume). FLAG_SECURE deliberately skipped (would block WhatsApp screenshot-sharing).

## Airplane-mode test — PASSED ✅ (on device 6dbf1af4, v1.0.4)
Offline→reconnect→sync verified end-to-end: cut wifi/data → app showed "Sin señal" →
created a solicitud offline (amber "Guardado · Se enviará solo") → outbox tracked
"1 se enviarán solos" → reconnected → auto-synced ("Todo enviado") → real row landed
in sgc.solicitudes_material (BRISAS CITY CENTER, Xaviel Terrero, pendiente). Interconnection
confirmed (shows in SGC Solicitudes + badge). Offline-first promise proven on a real phone.

## v1.0.5 round (units, incidents, feedback)
- **Units are now admin-managed** (SGC): `sgc.unidades` catalog (seeded from the old hardcoded list) + **Administración → Unidades** (create/rename/activate). The artículo form reads units from the DB. App shows units from the artículo (no app change needed).
- **Incident emails retargeted**: now go to the incident PROJECT's team (proyecto_empleados→empleados→usuarios) + admins, not all PMs company-wide. Redeployed.
- **In-app "Reportar un problema"** (Perfil → SGC reportes_usuario → Administración → Comentarios y Reportes). RLS insert verified.
- v1.0.5 built + published to the download page. ⚠️ Device was unplugged at the end — reinstall to the phone via the download page (or `adb install -r` when reconnected). App was fully on-device tested in prior rounds; this round verified via RLS tests + builds.

## v1.1.0 round — app is a fuller "child of the web"
- **App Admin section** (gated by `admin` module, Home tile + Perfil): Reportes (view/resolve),
  Catálogos de bitácora, Unidades, Historial de conteos. RLS-gated server-side (is_admin).
- **App Soporte/Ayuda** page (FAQ + reportar), linked from Perfil.
- **Bitácora catalogs now admin-managed** (`sgc.bitacora_catalogos`; CHECKs dropped). Both the app
  wizard and the SGC nueva-bitácora form load them from the DB (built-in lists = offline fallback).
  Manage in: app Admin → Catálogos, or SGC Administración → Catálogos de bitácora.
- **Conteo/ajuste history**: app Admin → Historial de conteos, and SGC Inventario → Conteos y ajustes.
- v1.1.0 built + published. ⚠️ Device was offline — reinstall via the download page or adb when reconnected.

## Remaining (needs you / optional)
- **Rotate Supabase service_role/secret keys** (dashboard — they passed through chat).
- **Back up the keystore** (`android/csd-release.keystore` + `keystore.properties`).
- Airplane-mode capture→reconnect→sync test on a real device (camera + offline queue).
- Optional: notificar-incidente recipients (currently admin+proyectos) — tune if you want
  project-specific supervisors; set NOTIFICATIONS_FROM_EMAIL + Resend key in Vault to enable email.

## SGC web pending YOUR commit/push (deploys to Vercel prod)
`dev/SGC` has uncommitted changes: Flota "Responsabilidad" view (M2) + Conductores user-link (conduces).
`git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" status`

## How to run
```
cd "C:/Users/xavie/Desktop/X Dev/dev2/csd-app"
npm start            # PWA at http://localhost:4200
npm run build        # prod build check
```
