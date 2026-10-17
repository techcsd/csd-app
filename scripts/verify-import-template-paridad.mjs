// verify-import-template-paridad.mjs — GUARDA DE REGRESIÓN (CQ4-g).
//
// Xaviel (nota #243, ronda CQ): "el excel debería pedir más informaciones, ya
// que el sistema las usa" — un campo que el formulario manual de "Nuevo
// vehículo"/"Nuevo conductor" pide y la plantilla de importación NO conoce es
// un dato que solo se puede capturar a mano, nunca por lote. Este guard
// compara (por texto, sin compilar TS) los signals de datos de
// `vehiculo-form.ts`/`conductor-form.ts` contra los campos declarados en
// `ENTIDADES_IMPORTACION` (`core/services/importacion.service.ts`) y falla si
// el formulario tiene un campo de dato real que la plantilla no cubre.
//
// Exclusión explícita (regla G del prompt CQ4): fotos/documentos (se suben
// aparte, no son columnas de Excel), "es prueba" ya cubierto, estado de UI
// (loading/submitting/...), y el vínculo cuenta-de-usuario del conductor
// (`usuarioId` — es una ACCIÓN de "dar acceso", no un dato importable).
//
// Mapeo signal→campo de plantilla: los nombres de signal (camelCase, pensados
// para la UI) no son 1:1 con las claves `t` de la plantilla (snake_case, igual
// a la columna del Excel) — se mantiene a mano aquí; si agregas un campo nuevo
// al formulario, agrégalo también a este mapa (o a la lista de exclusión si es
// deliberadamente manual-only).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const IMPORTACION_SERVICE = join(ROOT, 'src/app/core/services/importacion.service.ts');

const FORMS = [
  {
    entidad: 'vehiculos',
    archivo: join(ROOT, 'src/app/pages/transporte/vehiculos/vehiculo-form.ts'),
    // signal de datos del vehículo → campo `t` de ENTIDADES_IMPORTACION.vehiculos.campos
    mapa: {
      placa: 'placa',
      marca: 'marca',
      modelo: 'modelo',
      anio: 'anio',
      tipo: 'tipo',
      estado: 'estado',
      kilometraje: 'kilometraje',
      vencMatricula: 'vencimiento_matricula',
      vencSeguro: 'vencimiento_seguro',
      kmUltMant: 'km_ultimo_mantenimiento',
      intervaloMant: 'intervalo_mantenimiento_km',
      rendimientoEsperado: 'rendimiento_esperado_km_gal',
      notas: 'notas',
      vin: 'vin',
      numeroMatricula: 'numero_matricula',
      numeroSeguro: 'numero_seguro',
      aseguradora: 'aseguradora',
      color: 'color',
      medidaUso: 'medida_uso',
      uso: 'uso',
      esPrueba: 'es_prueba',
    },
    // signals de UI/flujo, no son un dato del vehículo — no son candidatos.
    excluir: ['vehiculoId', 'loading', 'submitting', 'borradorPrevio', 'foto', 'fotosExistentes', 'fotoUrls'],
  },
  {
    entidad: 'conductores',
    archivo: join(ROOT, 'src/app/pages/transporte/conductores/conductor-form.ts'),
    mapa: {
      nombre: 'nombre',
      cedula: 'cedula',
      licenciaTipo: 'licencia_tipo',
      licenciaNumero: 'licencia_numero',
      licenciaVencimiento: 'licencia_vencimiento',
      tipoAutorizado: 'tipo_vehiculo_autorizado',
      nota: 'nota',
      tags: 'tags',
      esPrueba: 'es_prueba',
    },
    // `usuarioId` es la acción "dar acceso" (vincula una cuenta de login), no un
    // dato del conductor — nunca viene de un Excel. El resto es estado de UI.
    // `esPrueba`: hueco conocido y aceptado (CQ4, 17-oct-2026) — a diferencia de
    // `importar_vehiculos`, el RPC `importar_conductores` del padre NO lee
    // `v_fila->>'es_prueba'` (ni en el INSERT ni en el UPDATE); agregar la columna
    // a la plantilla sin que el RPC la use engañaría al usuario (parecería
    // funcionar y no haría nada). Avisado en PARIDAD.md — se cierra cuando el
    // padre espeje el mismo `case when v_fila ? 'es_prueba'` que ya tiene vehiculos.
    excluir: [
      'conductorId', 'loading', 'borradorPrevio', 'usuarios', 'categorias',
      'usuarioId', 'tagInput', 'submitting', 'docCedula', 'docLicFrente',
      'docLicDorso', 'mostrarAcceso', 'nuevoConductorId', 'esPrueba',
    ],
  },
];

function camposDeEntidad(src, entidad) {
  // Extrae el bloque de `campos: [...]` de la entidad dada dentro de
  // ENTIDADES_IMPORTACION (texto, no AST — suficiente para esta guarda).
  const reEntidad = new RegExp(`key:\\s*'${entidad}'[\\s\\S]*?campos:\\s*\\[([\\s\\S]*?)\\]\\s*,\\s*foto:`);
  const m = src.match(reEntidad);
  if (!m) return null;
  const bloque = m[1];
  const campos = new Set();
  const reCampo = /t:\s*'([a-z0-9_]+)'/g;
  let cm;
  while ((cm = reCampo.exec(bloque))) campos.add(cm[1]);
  return campos;
}

function signalsDeclarados(src) {
  // `nombre = signal<Tipo>(valor)` o `nombre = signal(valor)` (ignora `private`).
  const out = [];
  const re = /^\s*(?:private\s+)?([a-zA-Z0-9_]+)\s*=\s*signal[<(]/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

const importSrc = readFileSync(IMPORTACION_SERVICE, 'utf8');
const errores = [];

for (const form of FORMS) {
  const campos = camposDeEntidad(importSrc, form.entidad);
  if (!campos) {
    errores.push(`No pude encontrar los campos de '${form.entidad}' en ENTIDADES_IMPORTACION (¿cambió el formato del archivo?).`);
    continue;
  }
  const formSrc = readFileSync(form.archivo, 'utf8');
  const signals = signalsDeclarados(formSrc);

  for (const signal of signals) {
    if (form.excluir.includes(signal)) continue;
    const campoPlantilla = form.mapa[signal];
    if (!campoPlantilla) {
      errores.push(
        `${form.entidad}: el signal '${signal}' de '${form.archivo.split(/[\\/]/).pop()}' no está mapeado ` +
        `a ningún campo de la plantilla NI en la lista de exclusión de este guard (scripts/verify-import-template-paridad.mjs). ` +
        `Si es un dato real del formulario, agrégalo a ENTIDADES_IMPORTACION Y a este mapa; si es solo estado de UI, agrégalo a 'excluir'.`,
      );
      continue;
    }
    if (!campos.has(campoPlantilla)) {
      errores.push(
        `${form.entidad}: el formulario captura '${signal}' (→ '${campoPlantilla}') pero la plantilla de importación ` +
        `NO tiene ese campo — un dato que el sistema usa solo se podría cargar a mano, nunca por lote (CQ4-g).`,
      );
    }
  }
}

if (errores.length) {
  console.error('[verify-import-template-paridad] ✗');
  for (const e of errores) console.error('  - ' + e);
  process.exit(1);
}
console.log('[verify-import-template-paridad] ✓ todo campo real del formulario de vehículo/conductor está en su plantilla de importación.');
