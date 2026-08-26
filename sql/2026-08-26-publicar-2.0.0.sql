-- PROMPT-14 (AY) — publicar 2.0.0 (móvil) rolling.
-- AY3/AY4 (acceso de Ingenieros por submódulo: Requisición + Proyectos de SUS obras,
-- costos/presupuesto ocultos) + AY5 (menú == guard a nivel submódulo) + AY7 (banner
-- "USUARIO DE PRUEBA"). FASE 1 (recepción canónica ver+foto+firma) ya estaba en la app.
-- version_minima se mantiene INTACTA (2.0.0 NUNCA es mínima forzada; 1.96.4 sigue).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '2.0.0'),
       minima = false
 where plataforma = 'movil' and version = '2.0.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '2.0.0';

select (sgc.version_publicada()->>'version_publicada') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
