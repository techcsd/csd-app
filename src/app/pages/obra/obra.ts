import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigButton } from '../../shared/ui/big-button/big-button';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../shared/ui/select-list/select-list';
import { ObraService } from '../../core/services/obra.service';
import { UserContextService } from '../../core/services/user-context.service';
import { ObraProyecto, ResumenObra } from '../../core/models/obra.model';

interface ObraTile {
  key: string;
  icon: string;
  label: string;
  tint: string;
  /** Submódulo AG12 requerido (nivel ver). '' = solo módulo obra. */
  submodulo: string;
  /** Ruta destino; `:id` se reemplaza por la obra seleccionada, o cross-obra si `crossObra`. */
  route: string;
  crossObra?: boolean;
}

// Acciones del módulo Obra (una tarjeta = una tarea). Cada una gateada por submódulo.
const TILES: ObraTile[] = [
  { key: 'plan', icon: '📋', label: 'Plan del día', tint: '#0f766e', submodulo: 'obra.plan_dia', route: '/obra/plan/:id' },
  { key: 'nc', icon: '⚠️', label: 'Levantar no conformidad', tint: '#ea580c', submodulo: 'obra.no_conformidades', route: '/obra/nc/:id' },
  { key: 'incidente', icon: '🚨', label: 'Incidente / casi-accidente', tint: '#dc2626', submodulo: 'obra.no_conformidades', route: '/obra/incidente/:id' },
  { key: 'mis-nc', icon: '✅', label: 'Mis pendientes', tint: '#ca8a04', submodulo: 'obra.no_conformidades', route: '/obra/mis-nc', crossObra: true },
  { key: 'checklists', icon: '📝', label: 'Checklists de calidad', tint: '#2563eb', submodulo: 'obra.checklists', route: '/obra/checklists/:id' },
  { key: 'recursos', icon: '📦', label: 'Recursos y pedidos', tint: '#16a34a', submodulo: 'obra.plan_dia', route: '/obra/recursos/:id' },
  { key: 'subcontratistas', icon: '👷', label: 'Subcontratistas', tint: '#7c3aed', submodulo: 'obra.subcontratistas', route: '/obra/subcontratistas/:id' },
  { key: 'avance', icon: '📈', label: 'Avance de obra', tint: '#0891b2', submodulo: 'obra.avance', route: '/obra/avance/:id' },
  { key: 'logistica', icon: '🧪', label: 'Logística y pruebas', tint: '#b45309', submodulo: 'obra.avance', route: '/obra/logistica/:id' },
  { key: 'informe', icon: '📄', label: 'Informe semanal', tint: '#1e3a5f', submodulo: 'obra.informes', route: '/obra/informe/:id' },
];

/** AG16 — Hub del módulo "Mi obra": selección de obra + acciones gateadas por submódulo. */
@Component({
  selector: 'app-obra',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BigButton, EmptyState, Skeleton, CollapsibleSelect],
  templateUrl: './obra.html',
  styleUrl: './obra.scss',
})
export class ObraPage {
  private obra = inject(ObraService);
  private ctx = inject(UserContextService);
  private location = inject(Location);
  private router = inject(Router);

  loading = signal(true);
  obras = signal<ObraProyecto[]>([]);
  seleccionada = signal<ObraProyecto | null>(null);
  resumen = signal<ResumenObra | null>(null);
  readonly hoy = new Date().toISOString().slice(0, 10);

  /** Tiles visibles según los permisos AG12 del usuario. */
  tiles = computed(() => TILES.filter((t) => this.ctx.puedeVerSubmodulo(t.submodulo)));

  // AI14 — obra por dropdown estándar (no listado abierto de todas las obras).
  obraOptions = computed<SelectOption[]>(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  pickPorId(id: string): void {
    const o = this.obras().find((x) => x.id === id);
    if (o) this.pick(o);
  }

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const obras = await this.obra.misObras();
      this.obras.set(obras);
      // Recupera la obra activa previa, o auto-selecciona si hay una sola.
      const activa = this.ctx.obraActiva();
      const prev = activa ? obras.find((o) => o.id === activa.id) : null;
      if (prev) {
        this.seleccionada.set(prev);
        void this.cargarResumen(prev.id);
      } else if (obras.length === 1) this.pick(obras[0]);
    } finally {
      this.loading.set(false);
    }
  }

  pick(o: ObraProyecto): void {
    this.seleccionada.set(o);
    this.ctx.setObraActiva({ id: o.id, nombre: o.nombre });
    void this.cargarResumen(o.id);
  }

  private async cargarResumen(proyectoId: string): Promise<void> {
    this.resumen.set(null);
    try {
      this.resumen.set(await this.obra.resumenDelDia(proyectoId, this.hoy));
    } catch {
      /* el resumen es best-effort; el hub funciona sin él */
    }
  }

  cambiarObra(): void {
    this.seleccionada.set(null);
    this.resumen.set(null);
  }

  abrir(t: ObraTile): void {
    if (t.crossObra) {
      void this.router.navigate([t.route]);
      return;
    }
    const o = this.seleccionada();
    if (!o) return;
    void this.router.navigate([t.route.replace(':id', o.id)]);
  }

  back(): void {
    this.location.back();
  }
}
