-- Publicar 1.45.0 como versión ROLLING (no forzada). El piso forzado sigue en 1.42.0.
update sgc.app_versiones set publicada = true  where plataforma = 'movil' and version = '1.45.0';
update sgc.app_versiones set publicada = false where plataforma = 'movil' and version = '1.44.0';
