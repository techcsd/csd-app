import { inject, Injectable, signal } from '@angular/core';
import { PermissionsService, PermTipo } from './permissions.service';

/** Copy de la tarjeta de permiso por tipo (X4). */
interface PermisoCopy {
  icono: string;
  titulo: string;
  /** Se muestra cuando el permiso aún no se ha pedido (estado 'prompt'). */
  porque: string;
  /** Se muestra cuando el permiso está denegado y hay que ir a ajustes. */
  bloqueado: string;
}

const COPY: Record<PermTipo, PermisoCopy> = {
  location: {
    icono: '📍',
    titulo: 'Necesitamos tu ubicación',
    porque:
      'La usamos para marcar dónde recibes un vehículo, de dónde sale una ruta y para llevarte al destino.',
    bloqueado:
      'El permiso de ubicación está apagado para esta app. Actívalo en los ajustes para poder marcar tu ubicación.',
  },
  camera: {
    icono: '📷',
    titulo: 'Necesitamos la cámara',
    porque:
      'La usamos para tomar las fotos de tus reportes: vehículo, combustible, checklist, inventario y más.',
    bloqueado:
      'La cámara está bloqueada para esta app. Actívala en los ajustes para poder tomar fotos.',
  },
  mic: {
    icono: '🎤',
    titulo: 'Necesitamos el micrófono',
    porque: 'Lo usamos para grabar tus notas de voz en los reportes.',
    bloqueado:
      'El micrófono está bloqueado para esta app. Actívalo en los ajustes para grabar notas de voz.',
  },
  notifications: {
    icono: '🔔',
    titulo: 'Activa las notificaciones',
    porque: 'Para avisarte de rutas asignadas, aprobaciones y recordatorios de tu trabajo.',
    bloqueado:
      'Las notificaciones están apagadas. Actívalas en los ajustes para recibir avisos.',
  },
};

/** Lo que el host pinta en pantalla. */
export interface PermisoCard {
  tipo: PermTipo;
  modo: 'prompt' | 'denied';
  icono: string;
  titulo: string;
  texto: string;
  primaryLabel: string;
  /** Vacío → no se pinta el botón secundario. */
  secondaryLabel: string;
}

interface Pendiente {
  onPrimary: () => void;
  onSecondary: () => void;
}

/**
 * X4 — puerta de permisos centralizada. `asegurar(tipo)` devuelve una promesa
 * con `true` si la función puede continuar y `false` si no:
 *
 *  - granted → true directo, sin molestar.
 *  - prompt  → tarjeta propia explicando el PORQUÉ + "Otorgar permiso" → dispara
 *              el diálogo nativo; si el usuario acepta continúa.
 *  - denied  → tarjeta con instrucciones + "Abrir ajustes" (nativo) para
 *              reactivarlo a mano; devuelve false (la función degrada, nunca
 *              falla en silencio).
 *  - unavailable → false silencioso (el dispositivo no soporta ese permiso).
 *
 * Nunca inyectar este servicio dentro de PermissionsService (haría ciclo);
 * las páginas/serv. de captura lo llaman antes de usar el recurso.
 */
@Injectable({ providedIn: 'root' })
export class PermisoGateService {
  private perms = inject(PermissionsService);

  private _card = signal<PermisoCard | null>(null);
  /** Tarjeta activa (el host la observa). */
  card = this._card.asReadonly();

  private pendiente: Pendiente | null = null;

  /** Asegura el permiso `tipo`, mostrando la tarjeta si hace falta. */
  async asegurar(tipo: PermTipo): Promise<boolean> {
    const state = await this.perms.check(tipo);
    if (state === 'granted') return true;
    if (state === 'unavailable') return false;
    if (state === 'denied') {
      await this.mostrarDenied(tipo);
      return false;
    }
    return this.mostrarPrompt(tipo);
  }

  // --- acciones que dispara el host --------------------------------------

  primary(): void {
    const p = this.pendiente;
    this.pendiente = null;
    p?.onPrimary();
  }

  secondary(): void {
    const p = this.pendiente;
    this.pendiente = null;
    p?.onSecondary();
  }

  // --- internos ----------------------------------------------------------

  private mostrarPrompt(tipo: PermTipo): Promise<boolean> {
    const c = COPY[tipo];
    return new Promise<boolean>((resolve) => {
      this._card.set({
        tipo,
        modo: 'prompt',
        icono: c.icono,
        titulo: c.titulo,
        texto: c.porque,
        primaryLabel: 'Otorgar permiso',
        secondaryLabel: 'Ahora no',
      });
      this.pendiente = {
        onPrimary: async () => {
          this._card.set(null);
          const next = await this.perms.request(tipo);
          if (next === 'denied') {
            await this.mostrarDenied(tipo);
            resolve(false);
            return;
          }
          // 'granted' → OK. 'prompt' (p. ej. ubicación en PWA, cuyo diálogo real
          // lo dispara getPosition) → dejamos continuar al llamador.
          resolve(next === 'granted' || next === 'prompt');
        },
        onSecondary: () => {
          this._card.set(null);
          resolve(false);
        },
      };
    });
  }

  private mostrarDenied(tipo: PermTipo): Promise<void> {
    const c = COPY[tipo];
    const native = this.perms.isNative;
    return new Promise<void>((resolve) => {
      this._card.set({
        tipo,
        modo: 'denied',
        icono: c.icono,
        titulo: c.titulo,
        texto: native
          ? c.bloqueado
          : `${c.bloqueado} Búscalo en los ajustes del navegador para este sitio.`,
        primaryLabel: native ? 'Abrir ajustes' : 'Entendido',
        secondaryLabel: native ? 'Ahora no' : '',
      });
      this.pendiente = {
        onPrimary: async () => {
          this._card.set(null);
          if (native) await this.perms.openAppSettings();
          resolve();
        },
        onSecondary: () => {
          this._card.set(null);
          resolve();
        },
      };
    });
  }
}
