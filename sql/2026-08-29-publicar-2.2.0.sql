-- BB — publica 2.2.0 (rolling a todos). Mínima 1.96.4 INTACTA (no fuerza update).
update sgc.app_versiones
   set publicada = (version = '2.2.0')
 where plataforma = 'movil';
