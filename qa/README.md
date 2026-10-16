# qa/ — registros de prueba de release (CP5)

`scripts/release-check.mjs` exige un archivo `release-<version>.md` por cada
versión que se publique en prod. Formato esperado:

```
# Release X.Y.Z
- Equipo/dispositivo: <Samsung Xaviel | iPhone Raykler | …>
- Versión de origen: <X.Y.Z anterior — la actualización in-app se probó DESDE esta versión>
- Qué se probó: <actualización in-app + flujos ejercitados>
- Resultado: OK | FALLA (detalle)
- Fecha: <YYYY-MM-DD>
```

Si Xaviel ya dio el visto bueno antes de que `dev` lleve 24h con el commit
(check 1 de `release-check.mjs`), agrega además una línea que empiece con
`OK:` o `**OK de Xaviel**`.

Ver `docs/STAGING.md` (si existe) o `CLAUDE.md` § Regla 18 para el resto del
flujo dev → prod.
