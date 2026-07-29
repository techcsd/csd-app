# Device-QA — CSD App v1.34.0 (PROMPT-7 · Ronda 28/07 PM)

Validación post-publicación en teléfono real (Android; prioriza el OUKITEL). Donde diga **web**, verificar en SGC. Rollback al final si algo falla.

## 0. Preparación
- [ ] Obra de prueba CON **estructuras** (`proyecto_estructuras`: Bloque A/B, Piso R…) y CON **equipos de obra**; otra obra SIN estructuras/equipos (para el fallback a texto libre).
- [ ] Usuario **normal** (chofer, sin rol Tecnología) y usuario **privilegiado** (admin/tecnologia/gerencia/dirección).
- [ ] Marca como **prueba** lo que captures.

## 1. Actualización forzada (mínima)
- [ ] Equipo en 1.33.0 → al abrir **obliga a actualizar** a 1.34.0. Instala el APK del bucket.
- [ ] Perfil/Ajustes muestra **versión instalada 1.34.0**.

## 2. FASE 1 — Legibilidad (Z31/Z32)
- [ ] **Tecnología**: versión, tabs e items del historial legibles (nada oscuro sobre negro).
- [ ] **Auditoría**: KPI cards (Acciones/Usuarios/Áreas/Días activos) y barras legibles.
- [ ] También **Proyectos**, **Cronograma** e **Historial de checklists** legibles.

## 3. FASE 5 — Tecnología: gating + Dudas (Z26/Z30)
- [ ] Usuario **normal**: ve tile Tecnología; dentro ve Historial de versiones + Dudas; **NO** ve Reportes de errores.
- [ ] Usuario **privilegiado**: además ve Reportes de errores.
- [ ] **Dudas**: carga guías + preguntas; buscador filtra; coincide con la web; solo lo de tus módulos (admin ve todo).
- [ ] **Dudas offline**: abrir con señal → modo avión → reabrir → sigue mostrando (caché).

## 4. FASE 3 — Checklists / pre-uso (Z24)
- [ ] Hub Transporte → tile **"Hacer pre-uso"** → pre-uso (selector de vehículo del pool) en **≤2 toques**.
- [ ] **Historial de checklists**: el chofer solo ve los suyos; el elevado ve todos.

## 5. FASE 2 — Bitácora (Z20/Z22/Z21) — offline + web
- [ ] **Paso 5 (Z20)** obra CON estructuras: selector de bloques/pisos + "Otro". Obra SIN estructuras: texto libre.
- [ ] **Paso 6 (Z21)**: foto opcional por restricción seleccionada.
- [ ] **Paso 8 (Z22)** obra CON equipos: selector de equipos + "Otro". Sin equipos: texto libre.
- [ ] **Modo avión**: bitácora completa (estructura + foto paso 6 + equipo del catálogo) → reconecta → sincroniza sola.
- [ ] **Web**: la bitácora aparece con el bloque, el equipo y la **foto de la restricción** en el detalle.

## 6. FASE 4 — Combustible (Z23-app) — offline + web
- [ ] Echar combustible: paso 2 pide **producto (diésel/gasolina)** + **tarjeta (opcional)**; siguen las 3 fotos (recibo, tablero, **bomba en 0**).
- [ ] **Modo avión**: registra → reconecta → sincroniza (odómetro no retrocede).
- [ ] **Web**: detalle de echada muestra **Producto** + **Tarjeta**; la echada **concilia** contra la transacción del reporte importado.

## 7. FASE 6 — Responsive
- [ ] Pantalla ~360px + fuente grande del sistema: chips de estructura, `<select>` de equipo, botones de producto, input de tarjeta y cards de Dudas **no se cortan**; botones alcanzables con **teclado abierto**.

## 8. Sin regresiones (smoke)
- [ ] Bitácora normal, pre-uso completo, combustible, salida/entrada inventario, outbox (captura offline → sync).
- [ ] **Interconexión (regla #1)**: las capturas disparan notificaciones/badges/KPIs en la web como antes.

## Rollback (si algo falla)
```sql
update sgc.app_versiones set publicada=true, minima=true where plataforma='movil' and version='1.33.0';
update sgc.app_versiones set publicada=false, minima=false where plataforma='movil' and version='1.34.0';
```
