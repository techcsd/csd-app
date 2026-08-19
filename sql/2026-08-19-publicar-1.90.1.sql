-- PROMPT-28 (AX/AS) — publicar 1.90.1 (móvil) rolling. Incluye AS3 (PDF) + AS17 (fotos).
-- version_minima se mantiene en 1.70.0 (1.90.1 nunca es mínima forzada).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.90.1'),
       minima = false
 where plataforma = 'movil' and version = '1.90.1';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '1.90.1';

select (sgc.version_publicada()->>'version') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
