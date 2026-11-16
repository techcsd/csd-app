# Release 2.70.0

- Equipo/dispositivo: ninguno — NO hubo prueba en teléfono real antes de este release.
- Versión de origen: 2.69.0
- Qué se probó: idioma al 100 % en español/English/Kreyòl (ronda DP, PR #35). Verificado con
  Playwright en app-dev (QA desarrollador y QA flota elevado, en + ht, 390 px: 0 claves sin
  traducir en 7 rutas), `ng test` 66/66 y `npm run build` con todas las guardias. NO se probó
  la actualización in-app 2.69.0 → 2.70.0 en un teléfono real (CL4), ni Bitácora, ni modo oscuro.
- Resultado: OK por instrucción explícita de Xaviel (sin prueba en dispositivo)
- Fecha: 2026-11-16

OK: Xaviel autorizó explícitamente en el chat de esta sesión (2026-11-16) mergear, versionar y publicar 2.70.0 a prod ("do the merge by urself. i approve it. --yes do the bump, release, and all that stuff"). Riesgo asumido por él: la actualización in-app y el Kreyòl quedan sin validar en dispositivo/hablante (ver líneas de arriba).
