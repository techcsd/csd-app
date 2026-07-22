-- ACT.6 (ronda 7) — REVERTIR las RPCs de historiales mis_* (V2/V3).
-- Motivo: la app (PROMPT-15 FASE 4, ya shipeado en 1.25.1) resuelve V2/V3 con
-- SELECTS DIRECTOS filtrados por identidad (conductor_id / creado_por = auth.uid())
-- sobre checklists_vehiculo / registros_combustible / rutas, apoyándose en la RLS
-- (R14). Verificado en prod: el chofer ve solo lo suyo (9 checklists, 7 echadas,
-- 9 rutas) y NO ve lo de otros (fuga = 0). El prompt permitía explícitamente esa
-- vía ("o confirmar que un select filtrado por creado_por = auth.uid() es
-- suficiente con la RLS actual"). Las RPCs de la migración
-- 2026-07-22-v2v3-historiales-mis.sql quedaron SIN USO (nadie las llama) → se
-- eliminan para no dejar funciones SECURITY DEFINER muertas en la BD compartida.
-- Aditivo/seguro: idempotente; no toca datos ni contratos usados.

drop function if exists sgc.mis_reportes_semanales(date, date);
drop function if exists sgc.mis_preusos(date, date);
drop function if exists sgc.mis_echadas(date, date);
drop function if exists sgc.mis_rutas_creadas(date, date);

notify pgrst, 'reload schema';
