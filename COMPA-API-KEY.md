# Activar Compa — poner el `ANTHROPIC_API_KEY` (prerrequisito para probar el asistente)

Compa (FASE 4, AW4) ya está **implementado y publicado en la app**. Reusa la edge function `assistant` (desplegada por PROMPT-9). Lo único que falta para que funcione de punta a punta es el **secret `ANTHROPIC_API_KEY`** en el proyecto Supabase. Sin él la edge responde **503** y la app lo muestra con elegancia ("Compa aún no está configurado…"), no crashea.

> ⚠️ **Nunca pegues la API key en el chat.** Ponla en el dashboard de Supabase o pásala por variable de entorno / archivo `.local` gitignoreado, y que el comando la lea de ahí.

## Paso 1 — Conseguir la key (tú)
1. Entra a **https://console.anthropic.com** → **API Keys** → **Create Key**.
2. Cópiala (empieza con `sk-ant-…`). Guárdala en tu gestor de contraseñas.

## Paso 2 — Ponerla como secret de las Edge Functions (una de las dos vías)

**Vía A — Dashboard (más simple):**
1. Supabase → tu proyecto (el mismo de SGC) → **Edge Functions** → **Secrets** (o Project Settings → Edge Functions → Secrets).
2. **Add new secret**: nombre `ANTHROPIC_API_KEY`, valor = tu key. Guardar.
3. Las edge functions ya la ven en el siguiente request (no hace falta redeploy si la función lee `Deno.env.get('ANTHROPIC_API_KEY')` en runtime; si tienes dudas, redeploy `assistant` igual — es idempotente).

**Vía B — CLI (desde la carpeta del repo SGC, donde vive la función):**
```bash
# pon la key en una variable de entorno de tu shell (no la escribas en un archivo commiteado)
supabase secrets set ANTHROPIC_API_KEY="$TU_KEY" --project-ref <PROJECT_REF>
supabase functions deploy assistant --project-ref <PROJECT_REF>   # opcional pero recomendado
```

## Paso 3 — (si aplica) modelo por defecto
Si la edge `assistant` deja el modelo configurable por secret, usa el más capaz vigente:
- Opus 4.8 → `claude-opus-4-8`  ·  Sonnet 5 → `claude-sonnet-5`  ·  Haiku 4.5 → `claude-haiku-4-5-20251001`.
Para un asistente de campo con herramientas + confirmaciones, **Sonnet 5** suele ser el mejor balance costo/latencia; Opus 4.8 si quieres el máximo razonamiento. (Este paso es solo si la función expone `ANTHROPIC_MODEL` o similar; si no, ignóralo.)

## Paso 4 — Probar de punta a punta (device-QA)
Con la app **1.98.0** instalada:
1. Home → tile **🤖 Compa** → escribe **"¿Qué tareas tengo?"** → debe responder con datos reales (heredando tus permisos).
2. Prueba la **voz**: toca el micrófono → habla → se transcribe → edita si hace falta → enviar.
3. Prueba una **acción de escritura**: "Créame una tarea en mi obra …" → debe abrir la **hoja de Confirmar/Cancelar** con el resumen; al Confirmar, la tarea se crea (mismo RPC del flujo normal) y Compa lo confirma.
4. Con un rol limitado, pregúntale algo fuera de su alcance → debe responder natural ("no tengo acceso a eso"), no un error.
5. Rate limit: 60 mensajes/hora → al pasarse, mensaje amable (429).

## Si algo falla
- **Sigue en 503** tras poner el secret → confirma que el nombre es EXACTO `ANTHROPIC_API_KEY` y redeploy `assistant`.
- **401** → sesión; vuelve a entrar en la app.
- Revisa logs de la edge en Supabase → Edge Functions → `assistant` → Logs.

---
**App-side (ya hecho, nada que tocar):** `core/services/compa.service.ts` (chat/ejecutar/transcribir + manejo 401/429/503), `pages/compa/*` (chat + voz + hoja de confirmación), ruta `/compa` + tile "🤖 Compa" en el home (general para todos, sin gate de módulo).
