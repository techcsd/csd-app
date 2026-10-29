-- DA (cierre de ronda, app, 29-oct-2026) — publicar la versión móvil 2.60.0
-- (ronda CZ: Cotizaciones de Tecnología + Vault · ronda DA: inventario
-- tecnológico ampliado) como la recomendada a todos los usuarios.
--
-- Contexto: `npm run apk -- --env prod` + `npm run apk:publish -- --env prod`
-- ya registraron 2.60.0 en `sgc.app_versiones` (prod) y subieron el APK al
-- bucket. Eso NO publica (Y1: "registrar en el historial NO publica" —
-- CLAUDE.md del hijo) — falta este flip para que `version_publicada()`
-- devuelva 2.60.0 y la app avise "hay una versión nueva" a todos.
--
-- Regla 19 (CD10, no negociable): el hijo (csd-app) no aplica nada a prod
-- directo — deja el SQL fechado aquí y lo aplica el PADRE (SGC). Xaviel pidió
-- explícitamente "haz todo, no dejes nada pendiente"; esta es la única pieza
-- que, por esa regla, no puede ejecutar el propio repo hijo.
--
-- Aplicar en PROD (jeeqhgccqefbqilntcpu) con el flujo normal del padre
-- (apply-migration.mjs o consola, --env prod). Reversible: solo cambia dos
-- booleanos, ningún dato se pierde.
begin;

update sgc.app_versiones
   set publicada = true
 where plataforma = 'movil' and version = '2.60.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version = '2.58.5' and version <> '2.60.0';

commit;

-- Verificación esperada tras aplicar:
--   select version, publicada, minima from sgc.app_versiones
--    where plataforma='movil' order by fecha desc limit 3;
--   -- 2.60.0 | publicada=true
--   -- 2.58.5 | publicada=false
