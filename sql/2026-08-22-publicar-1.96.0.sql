-- PROMPT-6 (AU) — publicar 1.96.0 (móvil) rolling.
-- AU10 (PWA se actualiza sola) + AU16 (link Maps) + AU12 (apodos) + AU11/AU13 (catálogo)
-- + AU14 (wizard conduce 3 pasos) + AU15 (etiquetas).
-- version_minima se mantiene intacta (1.96.0 NUNCA es mínima forzada).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.96.0'),
       minima = false
 where plataforma = 'movil' and version = '1.96.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '1.96.0';

select (sgc.version_publicada()->>'version') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
