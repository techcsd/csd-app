-- DJ (hotfix, app, 05-nov-2026) — publicar la versión móvil 2.66.2 (hotfix de
-- crash en prod) y des-publicar las versiones rotas/viejas.
--
-- INCIDENTE: Misael reportó que la app se cerraba sola al abrirla en 2.66.0.
-- Causa raíz confirmada por adb logcat (dispositivo real): el APK de prod
-- publicado para 2.66.0 y 2.66.1 se construyó sin `google-services.json`
-- (Firebase) — al intentar registrar push en cada apertura, una excepción
-- nativa no atrapable desde JS mata el proceso completo. 2.66.2 se
-- reconstruyó con el archivo correcto y fue verificado en un dispositivo
-- real (adb install + logcat: "FirebaseApp initialization successful", sin
-- FATAL EXCEPTION, proceso vivo) antes de publicar.
--
-- URGENTE además porque `sgc.app_versiones` tenía DOS filas con
-- publicada=true para 'movil' (2.50.0 y 2.66.1 — la rota) al mismo tiempo:
-- version_publicada() devolvía 2.66.1 (la más nueva de las publicada=true),
-- es decir, el aviso "hay una versión nueva" de la app seguía apuntando a la
-- versión QUE CRASHEA incluso después de publicar 2.66.2 en el bucket. Sin
-- este flip, nadie sale del incidente por el camino normal de actualización.
--
-- (Nota aparte, no resuelta aquí: `app_versiones.publicada` no tiene ninguna
-- restricción/trigger que garantice una sola fila activa por plataforma —
-- el flujo depende de que cada "publicar X" acuerde apagar las anteriores a
-- mano, como hace este mismo archivo. Si se repite esto, vale la pena un
-- trigger `before update ... when (new.publicada)` que apague las demás
-- filas de la misma plataforma automáticamente.)
--
-- Regla 19 (CD10, no negociable): el hijo (csd-app) no aplica nada a prod
-- directo — deja el SQL fechado aquí y lo aplica el PADRE (SGC). Xaviel dio
-- el OK explícito en el chat ("so is ready? go ahead" / "u can do all by
-- urself") para este hotfix de incidente activo.
--
-- Aplicar en PROD (jeeqhgccqefbqilntcpu) con el flujo normal del padre.
-- Reversible: solo cambia booleanos, ningún dato se pierde.
begin;

update sgc.app_versiones
   set publicada = true
 where plataforma = 'movil' and version = '2.66.2';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '2.66.2' and publicada = true;

commit;

-- Verificación esperada tras aplicar:
--   select version, publicada, minima from sgc.app_versiones
--    where plataforma='movil' and publicada order by fecha desc;
--   -- debe dar UNA sola fila: 2.66.2 | publicada=true
--
--   select version_publicada from sgc.version_publicada('movil');
--   -- debe devolver '2.66.2'
