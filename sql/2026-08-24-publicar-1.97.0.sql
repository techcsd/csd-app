-- PROMPT-8 (AV) — publicar 1.97.0 (móvil) rolling.
-- AV1 (guard de la firma del despachante) + AV2 (gating "Mi rendimiento" por rol) +
-- AV6 (árbol de Ingeniería: "Crear ruta" a Flota) + AV3 (N ingenieros en la bitácora) +
-- AV4 (ficha de personal: cuadrilla + aseguramiento + filtros/semáforo).
-- version_minima se mantiene INTACTA (1.97.0 NUNCA es mínima forzada).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.97.0'),
       minima = false
 where plataforma = 'movil' and version = '1.97.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '1.97.0';

select (sgc.version_publicada()->>'version') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
