-- DE (cierre de ronda, app, 01-nov-2026) — publicar la versión móvil 2.62.0
-- (ronda DA 2.60.0: inventario tecnológico · ronda DB 2.61.0: Mi unidad,
-- registro rápido de personal, pagos, lector de documentos de flota ·
-- ronda DE 2.62.0: badges honestos en Inventario + transferencias de
-- conduce) como la recomendada a todos los usuarios.
--
-- Supersede a `2026-10-29-da-publicar-2.60.0.sql` (nunca aplicado — prod
-- salta directo de 2.58.5 a 2.62.0, sin publicar 2.60.0/2.61.0 por
-- separado; quedan igual en el historial, solo nunca tuvieron
-- publicada=true).
--
-- Contexto: `npm run apk -- --env prod` + `npm run apk:publish -- --env prod`
-- ya registraron 2.62.0 en `sgc.app_versiones` (prod) y subieron el APK al
-- bucket. Eso NO publica (Y1: "registrar en el historial NO publica" —
-- CLAUDE.md del hijo) — falta este flip para que `version_publicada()`
-- devuelva 2.62.0 y la app avise "hay una versión nueva" a todos.
--
-- Regla 19 (CD10, no negociable): el hijo (csd-app) no aplica nada a prod
-- directo — deja el SQL fechado aquí y lo aplica el PADRE (SGC). Xaviel dio
-- el OK explícito en el chat ("i test it on my phone, so is ready... do
-- all the stuff, release... to main") para publicar 2.62.0 en prod.
--
-- Aplicar en PROD (jeeqhgccqefbqilntcpu) con el flujo normal del padre
-- (apply-migration.mjs --env dev primero para el ledger, luego --env prod).
-- Reversible: solo cambia dos booleanos, ningún dato se pierde.
begin;

update sgc.app_versiones
   set publicada = true
 where plataforma = 'movil' and version = '2.62.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version = '2.58.5' and version <> '2.62.0';

commit;

-- Verificación esperada tras aplicar:
--   select version, publicada, minima from sgc.app_versiones
--    where plataforma='movil' order by fecha desc limit 5;
--   -- 2.62.0 | publicada=true
--   -- 2.58.5 | publicada=false
