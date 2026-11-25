# Release 2.73.1
- Equipo/dispositivo: ninguno — Claude no tenía teléfono conectado y Xaviel no indicó haber probado esta versión.
- Versión de origen: 2.73.0 (prod) — la actualización in-app 2.73.0→2.73.1 NO se probó.
- Qué cambia: solo el build (source maps ocultos que se retiran de dist/ y se suben a un bucket privado). Sin cambios de código de la app ni de pantallas.
- Qué verificó Claude: build con guards, 104 tests, test:canal; dist/ sin .map (el build falla si queda alguno); simbolización real contra el bucket privado; dos builds del mismo commit dan los mismos 446 nombres.
- Resultado: OK de build; NO verificado en dispositivo.
- Fecha: 2026-11-25

**OK de Xaviel** (25-nov-2026): «i allow u to do it, i give u my permitions. --yes» (sobre arreglar los stacks minificados y llevarlo adelante).
