# Release 2.66.3

- **Equipo/dispositivo:** teléfono Android conectado por USB (segundo dispositivo de prueba; PIN desconocido, restablecido vía "¿Olvidaste tu PIN?" + login con `qa-flota-elevado@dev.constructorasd.local`, rol jefe_flota).
- **Versión de origen:** 2.66.2 (la publicada en prod, ya sin el crash).
- **Qué se probó (en vivo, con capturas en cada paso):**
  - Login con cuenta real de dev, creación de PIN nuevo, "Novedades" confirma **CSD APP 2.66.3** instalada.
  - Home muestra "HOY" con el chevron nuevo (▾); al tocar el título se pliega (chevron pasa a ▸, el cuerpo —KPIs y feed— desaparece, la tarjeta queda angosta); al tocar de nuevo se despliega igual que antes.
  - Perfil → "Ocultar 'Hoy' del inicio" / "Ocultar 'Pulso de obras' del inicio": al tocar, cambia a "Mostrar…" (confirmado con toast verde de éxito) y, al volver a Home, la sección desaparece POR COMPLETO (no solo plegada). Al volver a tocar "Mostrar" en Perfil, la sección reaparece en Home. Probado round-trip completo en ambos interruptores, restaurados al estado por defecto ("Ocultar"/visible) al terminar.
  - No se pudo probar "Pulso de obras" desplegado con datos reales (la cuenta QA no tenía obras con actividad hoy para mostrar el anillo), pero el mismo mecanismo de plegado/apagado que si se vio con "Hoy" es exactamente el mismo código para ambas secciones.
- **Verificación adicional:** `npm run build` + `npm test` (63/63) verdes. La guarda nueva (`verificarGoogleServicesProd`) se probó manualmente: falla sin el archivo, pasa con el archivo presente.
- **Resultado:** OK — funciona en un teléfono real.
- **Fecha:** 2026-11-05.

OK: Xaviel escribió "u can do all by urself, u can create the pr and aprove it and conitnue working by urself", 2026-11-05 — autoriza continuar el pipeline hasta prod sin pausar en cada paso. Verificación en vivo del cambio la hizo Claude en el teléfono conectado, a pedido explícito de Xaviel ("my tecnologia@constructorasd.com doesnt work here... continue working" tras resolver el acceso con una cuenta QA de dev).
