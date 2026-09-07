import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { LiveRefreshDirective } from '../../shared/ui/live-refresh/live-refresh.directive';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog/confirm-dialog';
import { BottomSheet } from '../../shared/ui/bottom-sheet/bottom-sheet';
import { ToggleSwitch } from '../../shared/ui/toggle-switch/toggle-switch';
import {
  NotificacionesService,
  Notificacion,
  NotifEstado,
  notifAppRoute,
} from '../../core/services/notificaciones.service';
import { ToastService } from '../../core/services/toast.service';
import { formatFechaCortaHora } from '../../core/util/fecha';

/**
 * BK1 — lista de respaldo si `mis_notif_estado()` falla (sin red / RPC vieja). El
 * catálogo real vive ahora en `sgc.notif_tipo` (padre) y lo pinta la RPC; esta lista
 * solo cubre el caso degradado. Etiquetas alineadas con el catálogo (antes divergían:
 * "Nuevas versiones de la app" vs "Nuevas versiones").
 */
const CATEGORIAS_FALLBACK: { tipo: string; label: string }[] = [
  { tipo: 'version_publicada', label: 'Nuevas versiones' },
  { tipo: 'material_no_catalogado', label: 'Material no catalogado' },
  { tipo: 'otros_valor', label: 'Valores fuera de catálogo' },
  { tipo: 'solicitud_movimiento', label: 'Solicitudes de movimiento' },
  { tipo: 'mensaje', label: 'Mensajes de chat' },
  { tipo: 'soporte', label: 'Soporte' },
  { tipo: 'nota_compartida', label: 'Notas compartidas' },
  { tipo: 'flota', label: 'Avisos de flota' },
  { tipo: 'transporte', label: 'Transporte y rutas' },
  { tipo: 'conduce', label: 'Conduces' },
  { tipo: 'novedad', label: 'Novedades' },
];

/** BK1 — alarmas dominicales: se MUESTRAN (son ruido de teléfono) pero no se apagan
 *  a la ligera (el padre las marca es_operativa); van como "Siempre activa". */
const ALARMAS = new Set(['alarma-reporte-semanal', 'alarm-weekly-inspection']);

/** AE — bandeja de avisos in-app (sgc.notificaciones): firmas pendientes, cierres,
 *  avisos de módulo. Tocar un aviso lo marca leído y navega a su destino (AF6). */
@Component({
  selector: 'app-avisos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, ConfirmDialog, LiveRefreshDirective, BottomSheet, ToggleSwitch],
  templateUrl: './avisos.html',
  styleUrl: './avisos.scss',
})
export class AvisosPage {
  private service = inject(NotificacionesService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private route = inject(ActivatedRoute);

  readonly fechaHora = formatFechaCortaHora;

  loading = signal(true);
  refrescando = signal(false);
  avisos = signal<Notificacion[]>([]);
  confirmBorrarTodas = signal(false);

  // BK1 — preferencias de notificación: catálogo completo (sgc.notif_tipo) + mi
  // preferencia + estado de Administración, vía `mis_notif_estado()`.
  prefsAbierto = signal(false);
  estados = signal<NotifEstado[]>([]);

  /** Tipos que se muestran en el panel: los apagables (no operativos) + los que
   *  Administración apagó (para que el usuario lo vea) + las alarmas dominicales. */
  estadosVisibles = computed(() =>
    this.estados().filter(
      (e) => !e.es_operativa || e.deshabilitado_por_admin || ALARMAS.has(e.tipo),
    ),
  );

  constructor() {
    void this.load();
    // BF4 — deep-link desde Perfil: /avisos?prefs=1 abre directo las preferencias.
    if (this.route.snapshot.queryParamMap.get('prefs') === '1') {
      void this.abrirPrefs();
    }
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.avisos.set(await this.service.getMisNotificaciones());
    } catch {
      this.toast.error('No se pudieron cargar los avisos.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  /** AM2 — refresco homologado (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void {
    void this.load(silent);
  }

  iconFor(tipo: string): string {
    if (tipo === 'firma') return '✍️';
    if (tipo === 'error' || tipo === 'alerta') return '⚠️';
    return '🔔';
  }

  async abrir(n: Notificacion): Promise<void> {
    if (!n.leida) {
      this.avisos.update((list) => list.map((x) => (x.id === n.id ? { ...x, leida: true } : x)));
      void this.service.marcarLeida(n.id).catch(() => {});
    }
    // AF6 — deep-link: traduce la ruta (a veces web) a una ruta válida de la app.
    const dest = notifAppRoute(n);
    if (dest && dest !== '/home') {
      try {
        await this.router.navigateByUrl(dest);
      } catch {
        /* ignore */
      }
    }
  }

  /** ¿este aviso lleva a algún lado? (para pintar la flecha ›). */
  tieneDestino(n: Notificacion): boolean {
    return notifAppRoute(n) !== '/home';
  }

  /** AF6 — eliminar un aviso (optimista + rollback si falla). */
  async eliminar(n: Notificacion, ev: Event): Promise<void> {
    ev.stopPropagation();
    const prev = this.avisos();
    this.avisos.set(prev.filter((x) => x.id !== n.id));
    try {
      await this.service.eliminar(n.id, !n.leida);
    } catch {
      this.avisos.set(prev); // rollback
      this.toast.error('No se pudo eliminar el aviso.');
    }
  }

  /** AF6 — "borrar todas" (con confirmación). */
  pedirBorrarTodas(): void {
    this.confirmBorrarTodas.set(true);
  }
  cancelarBorrarTodas(): void {
    this.confirmBorrarTodas.set(false);
  }
  async borrarTodas(): Promise<void> {
    this.confirmBorrarTodas.set(false);
    const prev = this.avisos();
    this.avisos.set([]);
    try {
      await this.service.eliminarTodas();
      this.toast.success('Avisos eliminados.');
    } catch {
      this.avisos.set(prev);
      this.toast.error('No se pudieron eliminar.');
    }
  }

  async marcarTodas(): Promise<void> {
    try {
      await this.service.marcarTodasLeidas();
      this.avisos.update((list) => list.map((x) => ({ ...x, leida: true })));
      this.toast.success('Avisos marcados como leídos.');
    } catch {
      this.toast.error('No se pudo actualizar.');
    }
  }

  get hayNoLeidos(): boolean {
    return this.avisos().some((n) => !n.leida);
  }

  // ── BK1 — preferencias de notificación (catálogo + admin + propia) ───────────
  async abrirPrefs(): Promise<void> {
    this.prefsAbierto.set(true);
    try {
      this.estados.set(await this.service.misNotifEstado());
    } catch {
      // Respaldo: catálogo mínimo + mis prefs (sin poder mostrar estado de admin).
      try {
        const prefs = await this.service.misNotifPrefs();
        const sil = new Set(prefs.filter((p) => p.silenciado).map((p) => p.tipo));
        this.estados.set(
          CATEGORIAS_FALLBACK.map((c, i) => ({
            tipo: c.tipo,
            etiqueta: c.label,
            descripcion: null,
            es_operativa: false,
            orden: i,
            silenciado_por_mi: sil.has(c.tipo),
            deshabilitado_por_admin: false,
          })),
        );
      } catch {
        this.estados.set([]);
      }
    }
  }
  cerrarPrefs(): void {
    this.prefsAbierto.set(false);
  }
  /** ¿El usuario controla este tipo? (no operativo y no apagado por Administración). */
  editable(e: NotifEstado): boolean {
    return !e.es_operativa && !e.deshabilitado_por_admin;
  }
  /** El toggle muestra "recibir" (ON = NO silenciado por mí). */
  recibe(e: NotifEstado): boolean {
    return !e.silenciado_por_mi;
  }
  /** Texto para los tipos que el usuario NO controla. */
  estadoLabel(e: NotifEstado): string {
    return e.deshabilitado_por_admin ? 'Desactivado por Administración' : 'Siempre activa';
  }
  async onTogglePref(e: NotifEstado, recibir: boolean): Promise<void> {
    const silenciar = !recibir;
    // optimista
    this.estados.update((list) =>
      list.map((x) => (x.tipo === e.tipo ? { ...x, silenciado_por_mi: silenciar } : x)),
    );
    try {
      await this.service.setNotifPref(e.tipo, silenciar);
      void this.load(true); // re-filtra la bandeja
    } catch {
      // rollback
      this.estados.update((list) =>
        list.map((x) => (x.tipo === e.tipo ? { ...x, silenciado_por_mi: !silenciar } : x)),
      );
      this.toast.error('No se pudo guardar la preferencia.');
    }
  }

  back(): void {
    this.location.back();
  }
}
