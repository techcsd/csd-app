-- Fix combustible EN USO — publica 2.4.0 (rolling a todos). Mínima 1.96.4 INTACTA.
update sgc.app_versiones set publicada = (version = '2.4.0') where plataforma = 'movil';
