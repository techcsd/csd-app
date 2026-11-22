# Release 2.71.8
- Equipo/dispositivo: ninguno todavía — SIN prueba en iPhone real al momento de publicar.
- Versión de origen: 2.71.7
- Qué se probó: build verde; `reparar.html` es un archivo estático en `public/` (ES5, sin dependencias) que quita el service worker y borra cachés; las rutas con extensión no pasan por el service worker ni por la reescritura a `index.html` (vercel.json).
- NO probado: el flujo completo en un iPhone con la PWA en blanco; que el service worker no intercepte la página en Safari iOS.
- Resultado: pendiente prueba en el iPhone de Xaviel
- Fecha: 2026-11-22
**OK de Xaviel** 2026-11-22: «si, haz todo» (respuesta a: ¿Apruebo publicar la página de reparación, 2.71.8 en main?)
- [ ] Reparación probada en iPhone con la PWA en blanco
Probado por: nadie aún — pendiente
