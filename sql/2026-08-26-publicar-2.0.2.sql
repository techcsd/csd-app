-- PROMPT-14 (AY) follow-up — publicar 2.0.2 (móvil) rolling.
-- Rol Ingeniero de Oficina: ve todas las obras + costos (cubicaciones) pero NO gestiona
-- proyectos (AY4c). version_minima INTACTA (2.0.2 nunca es mínima forzada; 1.96.4 sigue).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '2.0.2'),
       minima = false
 where plataforma = 'movil' and version = '2.0.2';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '2.0.2';

select (sgc.version_publicada()->>'version_publicada') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
