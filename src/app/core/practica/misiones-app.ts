import { PracticaMision } from './practica.models';

/**
 * CM7 (PROMPT-95 F6) — escenarios LOCALES de las misiones de práctica de la app.
 *
 * F6a = el piloto ("Registrar combustible"). F6b = el resto: chofer (pre-uso,
 * tomar/soltar, entregar conduce, reportar estado) e ingeniero/capataz (parte diario,
 * pedir material, recibir conduce, apoyo de transporte). Cada usuario ve las de su rol
 * (admin ve todas); la combustible queda sin rol = intro para todos.
 *
 * Los `id` coinciden con `sgc.practica_misiones.id` (plataforma='app'). Los puntos y la
 * penalización del piloto son los del mock `CM7-demo-app` (fotos +40, datos +30,
 * <2min +25, km menor −10, aprueba desde 80). Las demás reparten ~100 por objetivos +
 * bono de tiempo.
 */

const CHOFER = ['chofer'];
const CAMPO = ['ingeniero_campo', 'ingeniero_oficina', 'capataz'];
// DG5 — roles con flota elevada (mantenimiento/ruta son decisión de jefe de flota o
// logística, no del chofer que solo ejecuta). Mismo criterio que esFlotaElevado().
const FLOTA = ['jefe_flota', 'logistica'];

// ── Piloto (F6a) ──────────────────────────────────────────────────────────────
const COMBUSTIBLE: PracticaMision = {
  id: 'app-combustible',
  titulo: 'Registrar combustible',
  sub: 'Km, galones, fotos',
  roles: [], // intro: cualquiera puede ensayar el flujo del chofer
  version: 1,
  objetivos: [
    { id: 'km', label: 'Kilometraje' },
    { id: 'galones', label: 'Galones' },
    { id: 'foto_recibo', label: 'Foto recibo' },
    { id: 'foto_tablero', label: 'Foto tablero' },
  ],
  pasos: [
    {
      id: 'km',
      tipo: 'valor',
      cta: 'Escribir el kilometraje',
      campo: {
        label: 'Kilometraje',
        objetivo: 'km',
        valor: '48.355',
        trampa: {
          valorMalo: '47.900',
          mensaje: 'El km es menor que el último registro (48.210). En la vida real esto se bloquea. −10 puntos.',
          penalizacionId: 'km_menor',
        },
      },
    },
    { id: 'galones', tipo: 'valor', cta: 'Escribir los galones', campo: { label: 'Galones', objetivo: 'galones', valor: '12.5' } },
    { id: 'foto_recibo', tipo: 'foto', cta: 'Tomar foto del recibo', foto: { label: 'Foto del recibo', objetivo: 'foto_recibo' } },
    { id: 'foto_tablero', tipo: 'foto', cta: 'Tomar foto del tablero', foto: { label: 'Foto del tablero', objetivo: 'foto_tablero' } },
    { id: 'guardar', tipo: 'confirmar', cta: 'Guardar' },
  ],
  reglas: {
    puntos: [
      { id: 'fotos', label: 'Foto del recibo y del tablero', puntos: 40, objetivos: ['foto_recibo', 'foto_tablero'] },
      { id: 'datos', label: 'Galones y monto correctos', puntos: 30, objetivos: ['km', 'galones'] },
    ],
    tiempo: { id: 'tiempo', label: 'Lo hiciste en menos de 2 minutos', puntos: 25, tiempoBonoSegundos: 120 },
    penalizaciones: [
      { id: 'km_menor', label: 'Kilometraje menor al anterior. Mira el tablero antes de escribir', puntos: -10 },
    ],
  },
  aprobarDesde: 80,
};

// ── Chofer (F6b) ──────────────────────────────────────────────────────────────
const PREUSO: PracticaMision = {
  id: 'app-preuso',
  titulo: 'Pre-uso de vehículo',
  sub: 'Checklist antes de salir',
  roles: CHOFER,
  version: 1,
  objetivos: [
    { id: 'km', label: 'Kilometraje' },
    { id: 'checklist', label: 'Checklist' },
    { id: 'foto', label: 'Fotos' },
    { id: 'firma', label: 'Firma' },
  ],
  pasos: [
    { id: 'km', tipo: 'valor', cta: 'Escribir el kilometraje', campo: { label: 'Kilometraje', objetivo: 'km', valor: '48.355' } },
    { id: 'checklist', tipo: 'accion', cta: 'Responder el checklist (OK / NO / N-A)', accion: { label: 'Checklist respondido', objetivo: 'checklist' } },
    { id: 'foto', tipo: 'foto', cta: 'Tomar la foto del vehículo', foto: { label: 'Foto del vehículo', objetivo: 'foto' } },
    { id: 'firma', tipo: 'accion', cta: 'Firmar con el dedo', accion: { label: 'Firma', objetivo: 'firma' } },
    { id: 'guardar', tipo: 'confirmar', cta: 'Confirmar y guardar' },
  ],
  reglas: {
    puntos: [
      { id: 'datos', label: 'Kilometraje correcto', puntos: 25, objetivos: ['km'] },
      { id: 'check', label: 'Checklist completo', puntos: 30, objetivos: ['checklist'] },
      { id: 'evidencia', label: 'Foto y firma', puntos: 25, objetivos: ['foto', 'firma'] },
    ],
    tiempo: { id: 'tiempo', label: 'Lo hiciste con calma y sin saltarte pasos', puntos: 20, tiempoBonoSegundos: 150 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

const USO_VEHICULO: PracticaMision = {
  id: 'app-uso-vehiculo',
  titulo: 'Tomar y soltar vehículo',
  sub: 'Uso de vehículo',
  roles: CHOFER,
  version: 1,
  objetivos: [
    { id: 'tomar', label: 'Tomar' },
    { id: 'fotos', label: 'Fotos' },
    { id: 'soltar', label: 'Soltar' },
  ],
  pasos: [
    { id: 'tomar', tipo: 'accion', cta: 'Tomar el vehículo', accion: { label: 'Vehículo tomado', objetivo: 'tomar' } },
    { id: 'foto1', tipo: 'foto', cta: 'Foto del frente', foto: { label: 'Foto del frente', objetivo: 'fotos' } },
    { id: 'soltar', tipo: 'accion', cta: 'Soltar el vehículo al siguiente', accion: { label: 'Vehículo soltado', objetivo: 'soltar' } },
    { id: 'guardar', tipo: 'confirmar', cta: 'Confirmar' },
  ],
  reglas: {
    puntos: [
      { id: 'tomar', label: 'Tomaste el vehículo', puntos: 30, objetivos: ['tomar'] },
      { id: 'fotos', label: 'Tomaste la foto', puntos: 25, objetivos: ['fotos'] },
      { id: 'soltar', label: 'Lo soltaste al terminar', puntos: 25, objetivos: ['soltar'] },
    ],
    tiempo: { id: 'tiempo', label: 'Rápido y sin enredos', puntos: 20, tiempoBonoSegundos: 90 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

const CONDUCE: PracticaMision = {
  id: 'app-conduce',
  titulo: 'Entregar un conduce',
  sub: 'Foto, firma y confirmación',
  roles: CHOFER,
  version: 1,
  objetivos: [
    { id: 'foto', label: 'Foto' },
    { id: 'firma', label: 'Firma' },
    { id: 'entregar', label: 'Entregar' },
  ],
  pasos: [
    { id: 'foto', tipo: 'foto', cta: 'Tomar la foto de la entrega', foto: { label: 'Foto de la entrega', objetivo: 'foto' } },
    { id: 'firma', tipo: 'accion', cta: 'Firmar la entrega', accion: { label: 'Firma de quien recibe', objetivo: 'firma' } },
    { id: 'entregar', tipo: 'confirmar', cta: 'Entregar el conduce' },
  ],
  reglas: {
    puntos: [
      { id: 'foto', label: 'Tomaste la foto de la entrega', puntos: 35, objetivos: ['foto'] },
      { id: 'firma', label: 'Tomaste la firma de quien recibe', puntos: 40, objetivos: ['firma'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin demoras', puntos: 25, tiempoBonoSegundos: 90 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

const REPORTE_ESTADO: PracticaMision = {
  id: 'app-reporte-estado',
  titulo: 'Reportar estado del trabajo',
  sub: 'Voy, llegué, terminé',
  roles: CHOFER,
  version: 1,
  objetivos: [
    { id: 'voy', label: 'Voy' },
    { id: 'llegue', label: 'Llegué' },
    { id: 'termine', label: 'Terminé' },
  ],
  pasos: [
    { id: 'voy', tipo: 'accion', cta: 'Marcar: voy en camino', accion: { label: 'Voy en camino', objetivo: 'voy' } },
    { id: 'llegue', tipo: 'accion', cta: 'Marcar: llegué', accion: { label: 'Llegué', objetivo: 'llegue' } },
    { id: 'termine', tipo: 'accion', cta: 'Marcar: terminé', accion: { label: 'Terminé', objetivo: 'termine' } },
    { id: 'guardar', tipo: 'confirmar', cta: 'Listo' },
  ],
  reglas: {
    puntos: [
      { id: 'estados', label: 'Reportaste tu avance (voy, llegué, terminé)', puntos: 75, objetivos: ['voy', 'llegue', 'termine'] },
    ],
    tiempo: { id: 'tiempo', label: 'Mantuviste tu estado al día', puntos: 25, tiempoBonoSegundos: 90 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

// ── Ingeniero / capataz (F6b) ─────────────────────────────────────────────────
const PARTE_DIARIO: PracticaMision = {
  id: 'app-parte-diario',
  titulo: 'Parte diario de bitácora',
  sub: 'Obra, clima y actividades',
  roles: CAMPO,
  version: 1,
  objetivos: [
    { id: 'obra', label: 'Obra' },
    { id: 'clima', label: 'Clima' },
    { id: 'actividades', label: 'Actividades' },
  ],
  pasos: [
    { id: 'obra', tipo: 'accion', cta: 'Elegir la obra', accion: { label: 'Obra elegida', objetivo: 'obra' } },
    { id: 'clima', tipo: 'accion', cta: '¿Llovió? marcar el clima', accion: { label: 'Clima marcado', objetivo: 'clima' } },
    { id: 'actividades', tipo: 'accion', cta: 'Marcar las actividades del día', accion: { label: 'Actividades marcadas', objetivo: 'actividades' } },
    { id: 'enviar', tipo: 'confirmar', cta: 'Enviar el parte' },
  ],
  reglas: {
    puntos: [
      { id: 'obra', label: 'Elegiste la obra', puntos: 25, objetivos: ['obra'] },
      { id: 'clima', label: 'Marcaste el clima', puntos: 25, objetivos: ['clima'] },
      { id: 'act', label: 'Marcaste las actividades', puntos: 30, objetivos: ['actividades'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin dejar campos pendientes', puntos: 20, tiempoBonoSegundos: 120 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

const PEDIR_MATERIAL: PracticaMision = {
  id: 'app-pedir-material',
  titulo: 'Pedir material',
  sub: 'Requisición para la obra',
  roles: CAMPO,
  version: 1,
  objetivos: [
    { id: 'obra', label: 'Obra' },
    { id: 'articulos', label: 'Artículos' },
    { id: 'enviar', label: 'Enviar' },
  ],
  pasos: [
    { id: 'obra', tipo: 'accion', cta: 'Elegir la obra', accion: { label: 'Obra elegida', objetivo: 'obra' } },
    { id: 'articulos', tipo: 'accion', cta: 'Agregar artículos y cantidades', accion: { label: 'Artículos agregados', objetivo: 'articulos' } },
    { id: 'enviar', tipo: 'confirmar', cta: 'Enviar la requisición' },
  ],
  reglas: {
    puntos: [
      { id: 'obra', label: 'Elegiste la obra', puntos: 30, objetivos: ['obra'] },
      { id: 'art', label: 'Agregaste los artículos', puntos: 45, objetivos: ['articulos'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin pedir de más', puntos: 25, tiempoBonoSegundos: 120 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

const RECIBIR_CONDUCE: PracticaMision = {
  id: 'app-recibir-conduce',
  titulo: 'Recibir un conduce',
  sub: 'Revisar, foto y confirmar',
  roles: CAMPO,
  version: 1,
  objetivos: [
    { id: 'revisar', label: 'Revisar' },
    { id: 'foto', label: 'Foto' },
    { id: 'confirmar', label: 'Confirmar' },
  ],
  pasos: [
    { id: 'revisar', tipo: 'accion', cta: 'Revisar lo que llegó', accion: { label: 'Revisado', objetivo: 'revisar' } },
    { id: 'foto', tipo: 'foto', cta: 'Tomar la foto de lo recibido', foto: { label: 'Foto de lo recibido', objetivo: 'foto' } },
    { id: 'confirmar', tipo: 'confirmar', cta: 'Confirmar la recepción' },
  ],
  reglas: {
    puntos: [
      { id: 'revisar', label: 'Revisaste lo que llegó', puntos: 35, objetivos: ['revisar'] },
      { id: 'foto', label: 'Tomaste la foto', puntos: 40, objetivos: ['foto'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin confirmar a ciegas', puntos: 25, tiempoBonoSegundos: 100 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

const APOYO: PracticaMision = {
  id: 'app-apoyo-transporte',
  titulo: 'Pedir apoyo de transporte',
  sub: 'Tipo, obra y día',
  roles: CAMPO,
  version: 1,
  objetivos: [
    { id: 'tipo', label: 'Tipo' },
    { id: 'obra_dia', label: 'Obra y día' },
    { id: 'enviar', label: 'Enviar' },
  ],
  pasos: [
    { id: 'tipo', tipo: 'accion', cta: 'Elegir el tipo de apoyo', accion: { label: 'Tipo elegido', objetivo: 'tipo' } },
    { id: 'obra_dia', tipo: 'accion', cta: 'Elegir la obra y el día', accion: { label: 'Obra y día', objetivo: 'obra_dia' } },
    { id: 'enviar', tipo: 'confirmar', cta: 'Enviar la solicitud' },
  ],
  reglas: {
    puntos: [
      { id: 'tipo', label: 'Elegiste el tipo de apoyo', puntos: 35, objetivos: ['tipo'] },
      { id: 'obra', label: 'Elegiste la obra y el día', puntos: 40, objetivos: ['obra_dia'] },
    ],
    tiempo: { id: 'tiempo', label: 'Claro y completo', puntos: 25, tiempoBonoSegundos: 100 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

// DG5 — "Firmar un conduce" (chofer): aceptar/firmar uno que le transfirieron o
// entregaron, distinto de CONDUCE (entregar en destino con foto).
const FIRMAR_CONDUCE: PracticaMision = {
  id: 'app-firmar-conduce',
  titulo: 'Firmar un conduce',
  sub: 'Revisar y firmar',
  roles: CHOFER,
  version: 1,
  objetivos: [
    { id: 'revisar', label: 'Revisar' },
    { id: 'firma', label: 'Firma' },
  ],
  pasos: [
    { id: 'revisar', tipo: 'accion', cta: 'Revisar el conduce que te transfirieron', accion: { label: 'Revisado', objetivo: 'revisar' } },
    { id: 'firma', tipo: 'accion', cta: 'Firmar para aceptarlo', accion: { label: 'Firma', objetivo: 'firma' } },
    { id: 'guardar', tipo: 'confirmar', cta: 'Confirmar' },
  ],
  reglas: {
    puntos: [
      { id: 'revisar', label: 'Revisaste el conduce antes de firmar', puntos: 40, objetivos: ['revisar'] },
      { id: 'firma', label: 'Firmaste para aceptarlo', puntos: 35, objetivos: ['firma'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin dejarlo pendiente', puntos: 25, tiempoBonoSegundos: 90 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

// DG5 — "Pedir solicitud de compra" (ingeniero/capataz): material que NO hay en
// almacén, distinto de PEDIR_MATERIAL (requisición de lo que sí hay en stock).
const SOLICITUD_COMPRA: PracticaMision = {
  id: 'app-solicitud-compra',
  titulo: 'Pedir solicitud de compra',
  sub: 'Lo que no hay en almacén',
  roles: CAMPO,
  version: 1,
  objetivos: [
    { id: 'obra', label: 'Obra' },
    { id: 'items', label: 'Artículos' },
    { id: 'enviar', label: 'Enviar' },
  ],
  pasos: [
    { id: 'obra', tipo: 'accion', cta: 'Elegir la obra', accion: { label: 'Obra elegida', objetivo: 'obra' } },
    { id: 'items', tipo: 'accion', cta: 'Agregar lo que hace falta comprar', accion: { label: 'Artículos agregados', objetivo: 'items' } },
    { id: 'enviar', tipo: 'confirmar', cta: 'Enviar la solicitud' },
  ],
  reglas: {
    puntos: [
      { id: 'obra', label: 'Elegiste la obra', puntos: 30, objetivos: ['obra'] },
      { id: 'items', label: 'Agregaste lo que hace falta', puntos: 45, objetivos: ['items'] },
    ],
    tiempo: { id: 'tiempo', label: 'Claro y completo', puntos: 25, tiempoBonoSegundos: 120 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

// DG5 — "Registrar mantenimiento" (jefe de flota/logística).
const MANTENIMIENTO: PracticaMision = {
  id: 'app-mantenimiento',
  titulo: 'Registrar mantenimiento',
  sub: 'Vehículo, tipo y qué se hizo',
  roles: FLOTA,
  version: 1,
  objetivos: [
    { id: 'veh', label: 'Vehículo' },
    { id: 'tipo', label: 'Tipo' },
    { id: 'desc', label: 'Descripción' },
  ],
  pasos: [
    { id: 'veh', tipo: 'accion', cta: 'Elegir el vehículo', accion: { label: 'Vehículo elegido', objetivo: 'veh' } },
    { id: 'tipo', tipo: 'accion', cta: 'Elegir el tipo (preventivo/correctivo)', accion: { label: 'Tipo elegido', objetivo: 'tipo' } },
    { id: 'desc', tipo: 'valor', cta: 'Describir qué se le hizo', campo: { label: 'Descripción', objetivo: 'desc', valor: 'Cambio de aceite y filtro' } },
    { id: 'guardar', tipo: 'confirmar', cta: 'Guardar' },
  ],
  reglas: {
    puntos: [
      { id: 'veh', label: 'Elegiste el vehículo', puntos: 30, objetivos: ['veh'] },
      { id: 'tipo', label: 'Elegiste el tipo', puntos: 25, objetivos: ['tipo'] },
      { id: 'desc', label: 'Describiste el trabajo', puntos: 30, objetivos: ['desc'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin dejarlo a medias', puntos: 15, tiempoBonoSegundos: 120 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

// DG5 — "Crear una ruta" (jefe de flota/logística planifica un viaje).
const RUTA: PracticaMision = {
  id: 'app-ruta',
  titulo: 'Crear una ruta',
  sub: 'Vehículo, origen y destino',
  roles: FLOTA,
  version: 1,
  objetivos: [
    { id: 'veh', label: 'Vehículo' },
    { id: 'destino', label: 'Destino' },
    { id: 'enviar', label: 'Enviar' },
  ],
  pasos: [
    { id: 'veh', tipo: 'accion', cta: 'Elegir el vehículo', accion: { label: 'Vehículo elegido', objetivo: 'veh' } },
    { id: 'destino', tipo: 'valor', cta: 'Escribir el destino', campo: { label: 'Destino', objetivo: 'destino', valor: 'OBRA DEMO — Torre Norte' } },
    { id: 'enviar', tipo: 'confirmar', cta: 'Crear la ruta' },
  ],
  reglas: {
    puntos: [
      { id: 'veh', label: 'Elegiste el vehículo', puntos: 35, objetivos: ['veh'] },
      { id: 'destino', label: 'Indicaste el destino', puntos: 40, objetivos: ['destino'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin demoras', puntos: 25, tiempoBonoSegundos: 90 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

// DG5 — "Crear orden de trabajo" (ingeniero/capataz, dos firmas: ingeniero + cliente).
const ORDEN_TRABAJO: PracticaMision = {
  id: 'app-orden-trabajo',
  titulo: 'Crear orden de trabajo',
  sub: 'Descripción y dos firmas',
  roles: CAMPO,
  version: 1,
  objetivos: [
    { id: 'desc', label: 'Descripción' },
    { id: 'firma_ing', label: 'Firma ingeniero' },
    { id: 'firma_cli', label: 'Firma cliente' },
  ],
  pasos: [
    { id: 'desc', tipo: 'valor', cta: 'Describir el trabajo pedido', campo: { label: 'Descripción', objetivo: 'desc', valor: 'Reparación de filtración en la losa del nivel 2' } },
    { id: 'firma_ing', tipo: 'accion', cta: 'Firmar como ingeniero', accion: { label: 'Firma del ingeniero', objetivo: 'firma_ing' } },
    { id: 'firma_cli', tipo: 'accion', cta: 'Firmar como cliente', accion: { label: 'Firma del cliente', objetivo: 'firma_cli' } },
    { id: 'guardar', tipo: 'confirmar', cta: 'Guardar' },
  ],
  reglas: {
    puntos: [
      { id: 'desc', label: 'Describiste el trabajo', puntos: 30, objetivos: ['desc'] },
      { id: 'firmas', label: 'Capturaste las dos firmas', puntos: 50, objetivos: ['firma_ing', 'firma_cli'] },
    ],
    tiempo: { id: 'tiempo', label: 'Sin dejarlo a medias', puntos: 20, tiempoBonoSegundos: 150 },
    penalizaciones: [],
  },
  aprobarDesde: 80,
};

/** Todas las misiones de práctica de la app. */
export const MISIONES_APP: PracticaMision[] = [
  COMBUSTIBLE,
  PREUSO,
  USO_VEHICULO,
  CONDUCE,
  REPORTE_ESTADO,
  PARTE_DIARIO,
  PEDIR_MATERIAL,
  RECIBIR_CONDUCE,
  APOYO,
  // DG5 — módulo Demo ampliado.
  FIRMAR_CONDUCE,
  SOLICITUD_COMPRA,
  MANTENIMIENTO,
  RUTA,
  ORDEN_TRABAJO,
];

/** Busca una misión por id. */
export function misionPorId(id: string): PracticaMision | null {
  return MISIONES_APP.find((m) => m.id === id) ?? null;
}
