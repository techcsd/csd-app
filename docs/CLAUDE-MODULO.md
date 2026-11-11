# MÓDULO CLAUDE — CSD App (DM-00, ronda DM, 11-nov-2026)

Ruta `/claude` (sin gate de módulo — todo usuario autenticado, como Notas).
Entrada: Perfil → "Claude: Setup y skills". Pestañas: **Inicio** (Setup +
enlace a "Mi conexión", la pantalla existente `/perfil/claude`) · **Skills**
(biblioteca, por rol) · **Crear** (skill guiada) · **Encuesta** (auditoría).

**Administrar (aprobar/publicar/archivar) y Auditoría (encuesta agregada +
organización) son SOLO WEB** (DM-00) — la app no tiene esas pantallas ni los
submódulos `tecnologia.claude_administrar`/`claude_auditoria`.

## Qué absorbe (nada se borra)

La app **no** absorbe `/perfil/claude` (el conector CR1 existente): sigue
siendo su propia pantalla ("Mi conexión" — estado/desconectar/borradores). El
módulo nuevo solo enlaza a ella desde Inicio, para no duplicar esa lógica.

## Datos y edges (reutilizados del padre, SQL ya en prod)

Mismas tablas que la web: `sgc.claude_skills`/`claude_skill_versiones` (RLS: lo
mío + publicado para mi rol/empresa), `claude_packs`/`claude_pack_items`,
`claude_progreso`, `claude_encuesta_respuestas`. Mismas 3 edges:
`claude-skill-validar` (sube/valida, usada por "Crear"), `claude-skill-descargar`
y `claude-pack-zip` (ambas devuelven un `.zip` listo para guardar/compartir).

- `core/services/claude-modulo.service.ts` — llamadas RPC/edge + outbox.
- `core/models/claude-modulo.model.ts` — tipos.
- `core/util/claude-skill-md.ts` — genera el `SKILL.md` (frontmatter + cuerpo)
  del formulario guiado; `generarSlug()` cumple el check de la BD (minúsculas/
  guiones, sin "claude"/"anthropic").
- `pages/claude/claude-modulo.ts` — las 4 pestañas en una sola página/ruta.

## Offline (DM-00: "lo que se crea sin red entra por el outbox")

Dos `tipo_op` nuevos, registrados en `ClaudeModuloService` (eager-booteado en
`app.config.ts`, S30-class — sin esto quedarían "En cola" para siempre):

- `claude_encuesta` → RPC `claude_encuesta_guardar` (texto puro, sin fotos).
- `claude_skill_crear` → edge `claude-skill-validar`, enviando el `SKILL.md`
  generado como un `Blob` de texto dentro de un `FormData` (sin Dexie nuevo:
  el contenido es texto, cabe entero en el payload JSON del outbox).

Descargar/compartir (`claude-skill-descargar`/`claude-pack-zip`) son
**online-only** (como el PDF de conduce): piden el `.zip` al servidor y lo
guardan vía `@capacitor/filesystem` + `@capacitor/share`, mismo patrón que
`conduce-pdf.service.ts`.

## Setup inicial (DM-10/DM-12, ya sembrado en prod)

6 skills + el pack "Setup inicial" (LEEME + hoja de buenas prácticas) vienen
del padre (migración `dm1`); la app solo los lista y los ofrece para
descargar/compartir — no los crea.

## Conector fase 2 (DM4) — apagado

`claude_skills_conector` sigue en `false`; la app no tiene ningún tool nuevo
que dependa de él (son RPCs consumidas solo desde MCP).

## Pendientes físicos de Xaviel

1. Probar el flujo completo en un dispositivo real (ver `qa/release-2.68.0.md`).
2. Revisar/editar el texto de las 6 skills de arranque si hace falta (se edita
   en la web, no en la app).
3. Decidir si vale la pena un tablero visual nuevo para este módulo (hoy usa
   solo `btn-cta`/`btn-ghost`/`.field` existentes, sin CSS nuevo).
