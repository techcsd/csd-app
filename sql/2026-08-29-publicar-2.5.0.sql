-- Combustible EN USO en el selector — publica 2.5.0 (rolling). Mínima 1.96.4 INTACTA.
update sgc.app_versiones set publicada = (version = '2.5.0') where plataforma = 'movil';
