# BN1 — Orden de trabajo (app): contrato verificado + implementación + el hueco a cerrar

> Estado: **CONSTRUIDO en la app** (creación offline-first + ficha de lectura + PDF).
> El esquema del padre YA EXISTE y está verificado contra `../dev/SGC/sql/2026-09-09-bn1-orden-de-trabajo.sql`.
> ✅ **Idempotencia RESUELTA** — `crear_orden_trabajo` ahora acepta `p_id` (BN1b aplicado a prod, ver §4).

## 1. Contrato real del padre (verificado en el SQL)

- **Tipo:** `sgc.bitacoras.tipo = 'orden_trabajo'` (CHECK ampliado, aditivo). ✅ coincide con la asunción de FASE 2.4.
- **Tablas hijas:** `sgc.bitacora_orden_detalle` (1 renglón/orden) + `sgc.bitacora_orden_firmas` (rol ∈ {ingeniero, cliente}, único por rol).
- **Bucket de firmas:** `sgc-bitacora` (el MISMO que usa la app para fotos de bitácora → ya tiene políticas que funcionan).
- **RPC creación** `sgc.crear_orden_trabajo(p_proyecto_id uuid, p_fecha date, p_descripcion text, p_ubicacion text, p_cantidad numeric, p_unidad text, p_monto_estimado numeric, p_solicitado_por text, p_notas text, p_comentarios text, p_firma_ing jsonb, p_firma_cli jsonb, p_es_prueba boolean) returns uuid`
  - firma jsonb = `{ nombre, cedula, rol_desc, firma_path, metodo }`
  - **Dos firmas obligatorias** validadas server-side (admin puede omitir; la app NO usa esa vía — exige ambas).
- **RPC lectura** `sgc.orden_trabajo_detalle(p_bitacora_id uuid)` → `{ bitacora, detalle, firmas[] }`.

## 2. Implementación en la app (esta tanda)

- **Wizard offline-first** `pages/bitacora/orden-trabajo/` (6 pasos: obra+fecha → trabajo → detalles → firma ingeniero → firma cliente → resumen). Ambas firmas obligatorias en cliente (espeja el server).
- **Outbox** `tipo_op = 'orden_trabajo'`. Las dos firmas viajan como **slots de foto** (`firma_ing`/`firma_cli`) → el sync las sube a `sgc-bitacora` y el handler las resuelve a `firma_path`, arma el jsonb **campo por campo** (regla 10) y llama `crear_orden_trabajo`.
- **Payload** (campo por campo, nunca un `as` de formulario):
  `{ id, proyecto_id, fecha, descripcion, ubicacion, cantidad, unidad, monto_estimado, solicitado_por, notas, comentarios, firma_ing_meta:{nombre,cedula,rol_desc}, firma_cli_meta:{…}, es_prueba, capturado_en }`
- **Borrador** (texto, sin firmas — como todo el resto de la app) + **"Documentación en proceso"** (en-proceso mapea `orden_trabajo` en borrador+outbox).
- **Ficha de lectura:** `bitacora/detalle/:id` detecta `tipo=orden_trabajo`, llama `orden_trabajo_detalle`, resuelve las `firma_url` (URL firmada) y pinta trabajo + detalle + firmas.
- **Hub:** botón "🧾 Orden de trabajo" en `bitacora.html`. **Ruta:** `bitacora/orden-trabajo`.
- **es_prueba:** la app manda `false`; el trigger `trg_heredar_es_prueba` lo coalescea desde la obra (igual que parte/incidente).

## 3. Códigos de error — 9ª regla

El RPC rechaza los casos de negocio con `raise exception` = **P0001** ("Falta la firma del ingeniero/cliente", "La descripción… es obligatoria", "Falta la obra"). P0001 es el **canal legítimo** de validación de RPC (la app lo clasifica `validacion`→`dato`, muestra el mensaje real). ✅ **NO** usa un SQLSTATE de infra (23514/23502) para el rechazo de negocio → cumple la 9ª regla. La app además valida ambas firmas **antes** de encolar, así el P0001 casi nunca llega al outbox.

## 4. ✅ RESUELTO: `crear_orden_trabajo` ahora es idempotente (BN1b)

**Aplicado a prod** (`../dev/SGC/sql/2026-09-11-bn1b-orden-trabajo-idempotente.sql`, 11-sep): se
añadió `p_id uuid default null` (client-UUID) + `on conflict (id) do nothing` + retorno temprano
en el reintento. Retrocompatible: la WEB llama sin `p_id` (named args) → `p_id` cae a null → el
server genera el id (comportamiento idéntico). La app pasa `p_id: payload['id']` → un reintento
del outbox **no duplica** la orden firmada. Verificado en prod (firma con 14 args, PostgREST
recargado). El texto de abajo documenta el problema original y el fix.

### (histórico) El hueco que había: el RPC no aceptaba p_id

El RPC genera el id de la bitácora **server-side** (`insert … returning id`) y **no acepta `p_id`**. El modelo entero de la app es **idempotente-por-client-UUID** (ADR-002) porque el outbox **reintenta**: si el RPC hace COMMIT pero el 200 se pierde (señal de campo), el outbox reintenta → **orden de trabajo DUPLICADA** (con las firmas del cliente duplicadas). Es exactamente lo que `crear_bitacora_app` evita con su `p_id`.

**Fix del padre (aditivo, retrocompatible ≥2 versiones):** añadir `p_id uuid default null` y usarlo como id idempotente:

```sql
-- Añadir como PRIMER parámetro con default, o recrear con la firma nueva.
-- Idempotencia: si ya existe esa bitácora (reintento), no dupliques.
create or replace function sgc.crear_orden_trabajo(
  p_id uuid default null,   -- client-UUID (idempotencia del outbox)
  p_proyecto_id uuid ...    -- resto igual
) returns uuid ...
begin
  ...
  v_id := coalesce(p_id, gen_random_uuid());
  -- La cabecera con id explícito + ON CONFLICT para el reintento:
  insert into sgc.bitacoras (id, usuario_id, proyecto_id, fecha, tipo, comentarios, es_prueba)
  values (v_id, v_uid, p_proyecto_id, coalesce(p_fecha, current_date), 'orden_trabajo',
          nullif(trim(p_comentarios), ''), coalesce(p_es_prueba, false))
  on conflict (id) do nothing;
  -- Si el reintento no insertó (ya existía), devolver v_id sin duplicar hijas.
  if not found then return v_id; end if;
  ... detalle + firmas igual ...
  return v_id;
end;
```

La app **ya manda `id`** (client-UUID) en el payload; el día que el padre añada `p_id`, el handler pasa `p_id: payload['id']` (una línea) y queda idempotente. **Hasta entonces: no publicar el botón en producción** (el riesgo de duplicar una orden firmada es real, aunque poco frecuente y no destructivo).

## 5. Paridad web↔app

- Web: online-only (sube firmas → RPC). App: offline-first (outbox). Misma data, distinta experiencia (regla madre).
- La app captura y **ahora también muestra** (ficha) la orden. El **PDF/impresión** de la orden (la web lo tiene) queda como follow-up de paridad en la app (reusar el patrón de `conduce-pdf.service`).
- Recordatorio previo: la app tampoco captura `visita` (solo la muestra). La brecha de tipos capturables sigue siendo decisión de Xaviel.
