# Release 2.73.3
- Equipo/dispositivo: Chrome de escritorio (service worker real contra `dist` servido en localhost); Samsung SM-A205U conectado por adb (solo instalación y arranque).
- Versión de origen: 2.73.2 (dev) — la actualización 2.73.2→2.73.3 en un iPhone NO se probó.
- Causa: la telemetría de prod (`sgc.app_error_reports`) muestra iPhones en «pantalla de rescate» («script no cargó», «timeout 8s sin render») tras cada release. `main-*.js` importa 99 chunks (1,1 MB) al arrancar y el service worker solo precacheaba 5 archivos, así que el primer arranque tras un deploy los bajaba en vivo.
- Qué cambia: `scripts/ngsw-precache-inicial.mjs` (corre tras `ng build`) añade esos 99 chunks al grupo prefetch de `ngsw.json` con su sha1, y re-hashea lo que `patchDistForDev` edita después (en dev el SW fallaba por «hash mismatch» en index.html/manifest); el guard de arranque pasa de 8 s a 15 s.
- Qué verificó Claude: 111 tests, test:canal, build dev con guards; en Chrome real `/ngsw/state` = NORMAL con el grupo `app` de 104 archivos (99 chunks) instalado en caché y 0 hashes incorrectos; dist sin `.map`.
- Qué falta: probar en el iPhone de Xaviel una actualización real (2.73.3 → siguiente versión) y confirmar que ya no aparece «Reparar».
- Resultado: OK de build y de instalación del service worker en escritorio; sin verificar en iPhone.
- Fecha: 2026-11-25
