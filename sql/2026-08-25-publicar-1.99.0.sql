-- PROMPT-12 (AX) — publicar 1.99.0 (móvil) rolling.
-- AX7 (cantidad a prueba de dedazos: qty-input compartido, vaciar no borra el item,
-- tocar-y-teclear reemplaza) + AX6 ("Otros" en bitácora con texto obligatorio) +
-- AX10 (un solo "Uso de vehículo": desvío a la pantalla canónica + retorno al
-- borrador) + AX2 (login del capataz por cédula, "Con cédula") + AX4 (transparencia
-- del incentivo: renglón negativo por estancamiento con fechas + aviso "¿sigues en
-- ruta?"). version_minima se mantiene INTACTA (1.99.0 NUNCA es mínima forzada; 1.96.4 sigue).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.99.0'),
       minima = false
 where plataforma = 'movil' and version = '1.99.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '1.99.0';

select (sgc.version_publicada()->>'version_publicada') as publicada,
       (sgc.version_publicada()->>'version_minima') as version_minima;
