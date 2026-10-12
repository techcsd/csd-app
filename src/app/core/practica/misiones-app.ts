import { PracticaMision } from './practica.models';

/**
 * CM7 (PROMPT-95 F6) — escenarios LOCALES de las misiones de práctica de la app.
 *
 * F6a entrega el **piloto** ("Registrar combustible"). Las demás misiones (F6b:
 * pre-uso, tomar/soltar, entregar conduce, reportar estado; ingeniero: parte diario,
 * pedir material, recibir conduce, apoyo) se añaden aquí con la misma forma.
 *
 * Los `id` coinciden con `sgc.practica_misiones.id` (plataforma='app'); los puntos y
 * penalizaciones son los del mock `CM7-demo-app` (−10 por km menor al anterior, etc.).
 */

const COMBUSTIBLE: PracticaMision = {
  id: 'app-combustible',
  titulo: 'Registrar combustible',
  sub: 'Km, galones, fotos',
  roles: [], // todos (en la práctica cualquiera puede ensayar el flujo del chofer)
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
          mensaje:
            'El km es menor que el último registro (48.210). En la vida real esto se bloquea. −10 puntos.',
          penalizacionId: 'km_menor',
        },
      },
    },
    {
      id: 'galones',
      tipo: 'valor',
      cta: 'Escribir los galones',
      campo: { label: 'Galones', objetivo: 'galones', valor: '12.5' },
    },
    {
      id: 'foto_recibo',
      tipo: 'foto',
      cta: 'Tomar foto del recibo',
      foto: { label: 'Foto del recibo', objetivo: 'foto_recibo' },
    },
    {
      id: 'foto_tablero',
      tipo: 'foto',
      cta: 'Tomar foto del tablero',
      foto: { label: 'Foto del tablero', objetivo: 'foto_tablero' },
    },
    { id: 'guardar', tipo: 'confirmar', cta: 'Guardar' },
  ],
  reglas: {
    fotos: { id: 'fotos', label: 'Foto del recibo y del tablero', puntos: 40 },
    datos: { id: 'datos', label: 'Galones y monto correctos', puntos: 30 },
    tiempo: { id: 'tiempo', label: 'Lo hiciste en menos de 2 minutos', puntos: 25, tiempoBonoSegundos: 120 },
    penalizaciones: [
      {
        id: 'km_menor',
        label: 'Kilometraje menor al anterior. Mira el tablero antes de escribir',
        puntos: -10,
      },
    ],
  },
  aprobarDesde: 80,
};

/** Todas las misiones de práctica de la app (piloto + futuras). */
export const MISIONES_APP: PracticaMision[] = [COMBUSTIBLE];

/** Busca una misión por id. */
export function misionPorId(id: string): PracticaMision | null {
  return MISIONES_APP.find((m) => m.id === id) ?? null;
}
