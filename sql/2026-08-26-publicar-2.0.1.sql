-- PROMPT-14 (AY) follow-up — publicar 2.0.1 (móvil) rolling.
-- Estado de la orden de compra en "Mis requisiciones" (RPC mis_ordenes_de_compra).
-- version_minima se mantiene INTACTA (2.0.1 NUNCA es mínima forzada; 1.96.4 sigue).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '2.0.1'),
       minima = false
 where plataforma = 'movil' and version = '2.0.1';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '2.0.1';

select (sgc.version_publicada()->>'version_publicada') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
