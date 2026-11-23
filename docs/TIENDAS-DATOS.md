# CSD App — Formularios de datos de tienda (CI12)

Respuestas listas para **Seguridad de datos (Google Play)** y **Privacidad de la app (Apple)**. Fuente: inventario de datos y terceros (CONTEXTO-42 §CI2 / `DATOS-Y-TERCEROS.md` del padre). Si una función nueva recoge un dato nuevo o usa un tercero nuevo, **actualiza este documento y la política** (regla CI13).

## Inventario (base de las respuestas)
| Dato | Para qué | ¿Vinculado al usuario? | Tercero que lo procesa |
|---|---|---|---|
| Nombre, correo, teléfono, **cédula**, cargo, rol | Cuenta y operación | Sí | Supabase |
| **Ubicación precisa** (también en segundo plano, choferes que comparten) | Seguimiento de flota y rutas | Sí | Supabase |
| Fotos, firmas, PDFs | Evidencias de obra/inventario/flota | Sí | Supabase |
| **Audio** (notas de voz) | Incidentes/notas; transcripción | Sí | Supabase + Groq/OpenAI (si hay consentimiento IA) |
| ID de dispositivo, token de push, plataforma, versión | Notificaciones, soporte | Sí | Supabase, Google (FCM) |
| Registros de errores/diagnóstico | Soporte técnico | Sí | Supabase |
| Texto/dictado enviado al asistente, foto del recibo | Asistente IA / lectura de recibo (con consentimiento) | Sí | Anthropic, Groq/OpenAI |
| Foto de documento de identidad + foto de la persona con el documento (registro rápido de personal); foto de documento de vehículo (seguro/matrícula/marbete) | Lectura con IA para precargar el formulario (con consentimiento); **no se guarda la transcripción**, solo los campos del registro | Sí | Anthropic |
| Biometría | Desbloqueo | **No sale del teléfono** | — (local) |
| **(DM, 11-nov-2026)** Texto que la persona escribe para crear una "skill" de Claude (qué hace/cuándo usarla/pasos/ejemplo) | Guardar/descargar/compartir atajos de trabajo con Claude, por rol | Sí (owner_id) | Supabase (bucket privado `claude-skills`); el servidor escanea el texto buscando secretos antes de guardarlo |
| **(DM, 11-nov-2026)** Respuestas de texto libre a la encuesta de uso de Claude (opcional) | Auditoría interna de adopción de IA | Sí (una por persona, editable) | Supabase |

| **(DX, 23-nov-2026)** Mensajes entre empleados con adjuntos (imágenes, audio, PDF, Word, Excel, CSV, stickers) | Mensajería interna de trabajo | Sí | Supabase (buckets privados `sgc-mensajes`, `sgc-stickers`) |
| **(DX, 23-nov-2026)** Reportes de problemas/sugerencias con fotos y **documentos** (PDF, Word, Excel, CSV, TXT; ≤10 MB, ≤5) | Soporte técnico | Sí | Supabase (bucket privado `reportes`); la IA de resumen (Anthropic) lee texto, fotos y PDF del reporte |
| **(DX, 23-nov-2026)** **Escaneos de QR** de documentos (quién escaneó qué documento y cuándo; el QR NO lleva datos personales) | Llevar a la pantalla correcta y auditar | Sí | Supabase (`doc_qr_escaneos`). El **escáner en el teléfono** usa el módulo de código de barras de **Google ML Kit / Play services**: la imagen se procesa **en el dispositivo**, no se envía ni se guarda |
| **(DX, 23-nov-2026)** Estado de GPS del chofer (encendido/apagado/permiso, "sin señal") y su causa | Soporte y seguridad del chofer | Sí | Supabase |
| **(DX, 23-nov-2026)** Datos contables de conduces/entradas (cantidades, artículos, obra; nombre del chofer en el conduce) sincronizados al ERP contable | Registro contable de la empresa (lo hace el servidor, no el teléfono) | Sí (indirecto) | **Odoo** (instancia alojada de la empresa, proveedor de hosting Cloudpepper) |

**Terceros (procesadores):** Supabase (BD/archivos), Vercel (hosting web), Google (FCM, Maps Platform), Anthropic (Compa, leer-recibo, lector de documentos de personal y de flota — ronda DB), Groq/OpenAI (transcripción), Open-Meteo (clima), OpenStreetMap (mapas), **Google ML Kit / Play services (escáner de QR, procesamiento local en el dispositivo — DX)**, **Odoo/Cloudpepper (ERP contable de la empresa, lado servidor — DX)**.
**No hay** rastreo publicitario. Datos cifrados en tránsito (HTTPS). Se puede **pedir eliminación** de la cuenta.

---

## Google Play — Seguridad de datos
- **¿Recopila o comparte datos?** Sí, recopila. **Comparte con terceros** = sí (procesadores que prestan el servicio; no para publicidad).
- **¿Cifrado en tránsito?** Sí.
- **¿Se puede solicitar la eliminación de datos?** Sí (desde la app: Perfil › Privacidad; y web: `/politicas/eliminar-cuenta`).
- **Tipos de datos (todos "recopilados", vinculados al usuario, para "Funcionalidad de la app"; ninguno para publicidad/marketing):**
  - **Ubicación** → Ubicación precisa (sí; en segundo plano).
  - **Información personal** → Nombre, Correo, Teléfono, **Otros (cédula)**.
  - **Fotos y videos** → Fotos.
  - **Archivos y documentos** → PDFs/firmas, skills de Claude (texto/`.md`) creadas por la persona, **adjuntos de mensajes y de reportes (Word/Excel/PDF/CSV/TXT) — DX**.
  - **Audio** → Grabaciones de voz.
  - **ID del dispositivo u otros** → ID de dispositivo, token de notificaciones.
  - **Registros de la app** → Diagnóstico/errores (opcional, "Análisis/Funcionalidad").
- **Herramienta de monitoreo (`IsMonitoringTool`):** con CI5 el rastreo está ligado a la jornada, lo marca el propio chofer y es visible (notificación persistente) → es una app de empresa, no software espía oculto. Si Play lo pregunta: es seguimiento **laboral con conocimiento del empleado**.

## Google Play — otros formularios
- **Clasificación IARC:** sin contenido sensible → la más baja que permita el cuestionario. **Hay comunicación entre usuarios** (mensajería interna entre empleados) → decláralo.
- **Público objetivo:** **18+** (app laboral; no dirigida a menores).
- **Anuncios:** No. **Compras dentro de la app:** No. **Funciones financieras:** Ninguna. **App de noticias:** No.
- **Permiso de ubicación en segundo plano:** justificación + **video ≤30 s** (guion en `TIENDAS-REVISION.md`). Servicio en primer plano tipo **`location`**, iniciado por acción del usuario (elegir estado de jornada), con notificación persistente.

---

## Apple — Privacidad de la app (etiquetas)
Todas **"vinculadas al usuario"** y para **"Funcionalidad de la app"**. **Sin rastreo** (`NSPrivacyTracking=false`; no App Tracking Transparency).
- **Ubicación** → Ubicación precisa.
- **Información de contacto** → Nombre, Correo, Teléfono.
- **Otros datos** → **Cédula** (documento de identidad).
- **Fotos o videos.**
- **Audio** → Grabaciones de voz.
- **Identificadores** → ID de dispositivo, token de notificaciones.
- **Diagnóstico** → Datos de rendimiento/fallos.
- **Datos de uso:** mínimo (navegación interna para soporte) — opcional.

## Apple — cuestionario de edad + otros
- **Clasificación por edad:** sin contenido objetable → la más baja que permita el cuestionario (típicamente **4+**/**17+** solo si marcas algo; marca todo "Ninguno/Nunca"). App laboral.
- **Mensajería entre usuarios:** sí (empleados).
- **Encryption (`ITSAppUsesNonExemptEncryption`):** **NO** (solo HTTPS estándar).
- **Account deletion:** sí, dentro de la app (Perfil › Privacidad) + web `/politicas/eliminar-cuenta`.
- **Login:** cuentas creadas por la empresa, no hay registro propio → **no** requiere "Iniciar sesión con Apple".

---

## Revisión contra la 2.72.0 (DX, 23-nov-2026) — qué cambió respecto a la 2.44.0
Releído contra el código 2.71.x/2.72.0. Lo que **antes no se declaraba** o cambió:
1. **Adjuntos en mensajes y reportes** (documentos Office/PDF/CSV/TXT, audio, stickers) → ya cubierto por «Archivos y documentos»; añadido arriba.
2. **Escáner de QR** (nuevo, 2.72.0): **Cámara** (permiso `CAMERA`, ya declarado) + módulo **Google ML Kit** (procesamiento local; en Play: *no se recopila* ninguna imagen). Los **escaneos** (usuario + documento + hora) sí se guardan en el servidor.
3. **Odoo** como destino de datos contables (lado servidor) → declarado como procesador de la empresa; **no** es un SDK dentro de la app.
4. **Compa/IA (Anthropic):** además de texto, foto de recibo y documentos de identidad/vehículo, ahora puede recibir **PDF** de reportes (resumen para Tecnología) → sigue bajo consentimiento y solo en servidor.
5. **GPS en segundo plano:** sin cambios de datos; se registra además la **causa** de un fallo de captura («sin señal», «GPS apagado en el teléfono», rechazo del servidor).
6. **Reportes de errores (Vigía):** texto técnico sanitizado + versión + dispositivo; sin contenido de mensajes.
7. **Notificaciones push (Firebase/FCM)**, **idioma (es/en/ht)** y **modo práctica**: sin datos nuevos (el idioma es una preferencia de cuenta).
**Para Xaviel (regla CI13):** actualizar `DATOS-Y-TERCEROS.md` del padre y la política de privacidad pública con los puntos 2 y 3, y volver a revisar el formulario de Seguridad de datos de Play y las etiquetas de Apple antes de enviarlos.
