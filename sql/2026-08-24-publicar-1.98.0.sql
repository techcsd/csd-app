-- PROMPT-10 (AW) — publicar 1.98.0 (móvil) rolling.
-- AW3 (registro de galones a prueba de dedazos: parser locale-safe + valor
-- interpretado en vivo + validación cliente + ciclo needs_confirm) + AW2 (anomalía
-- con dirección: 'alto'=revisar lectura / 'bajo'=mantenimiento + referencia +
-- "Revisar y corregir") + AW1 (cronograma vacío ≠ error + proyecto de prueba
-- visible) + AW4 (Compa: asistente de IA por chat/voz con confirmación de acciones).
-- version_minima se mantiene INTACTA (1.98.0 NUNCA es mínima forzada; 1.96.4 sigue).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.98.0'),
       minima = false
 where plataforma = 'movil' and version = '1.98.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '1.98.0';

select (sgc.version_publicada()->>'version_publicada') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
