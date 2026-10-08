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
| Biometría | Desbloqueo | **No sale del teléfono** | — (local) |

**Terceros (procesadores):** Supabase (BD/archivos), Vercel (hosting web), Google (FCM, Maps Platform), Anthropic (Compa, leer-recibo), Groq/OpenAI (transcripción), Open-Meteo (clima), OpenStreetMap (mapas).
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
  - **Archivos y documentos** → PDFs/firmas.
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
