import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ReunionesService } from '../../../core/services/reuniones.service';
import { ReunionModalidad, ReunionTipo } from '../../../core/models/reunion.model';
import { ToastService } from '../../../core/services/toast.service';
import { fechaLocalISO } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

interface UsuarioBusqueda {
  id: string;
  nombre: string;
  email: string | null;
}

const MODALIDADES: { value: ReunionModalidad; label: string }[] = [
  { value: 'meet', label: 'Google Meet' },
  { value: 'presencial', label: 'Presencial' },
  { value: 'mixta', label: 'Mixta' },
];

/** CP8 F5.3 — "Programar desde la app" (versión corta del crear de la web). */
@Component({
  selector: 'app-reunion-crear',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CollapsibleSelect, TranslatePipe],
  templateUrl: './reunion-crear.html',
  styleUrl: './reunion-crear.scss',
})
export class ReunionCrearPage {
  private service = inject(ReunionesService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);

  readonly modalidades = MODALIDADES;

  tipos = signal<ReunionTipo[]>([]);
  obras = signal<{ id: string; nombre: string }[]>([]);
  cargando = signal(true);
  guardando = signal(false);

  tipoId = signal('');
  titulo = signal('');
  fecha = signal(fechaLocalISO());
  horaInicio = signal('09:00');
  horaFin = signal('10:00');
  modalidad = signal<ReunionModalidad>('meet');
  lugar = signal('');
  proyectoId = signal('');

  // Picker de participantes (patrón idéntico al de "Compartir" de Compa).
  partTerm = signal('');
  partBuscando = signal(false);
  partResultados = signal<UsuarioBusqueda[]>([]);
  partElegidos = signal<UsuarioBusqueda[]>([]);
  private partDebounce: ReturnType<typeof setTimeout> | null = null;

  tipoOptions = computed(() => this.tipos().map((t) => ({ id: t.id, label: t.nombre })));
  obraOptions = computed(() => [{ id: '', label: this.i18n.t('Sin obra') }, ...this.obras().map((o) => ({ id: o.id, label: o.nombre }))]);

  puedeGuardar = computed(() => !!this.tipoId() && !!this.titulo().trim() && !this.guardando());

  constructor() {
    void this.cargarCatalogos();
  }

  private async cargarCatalogos(): Promise<void> {
    this.cargando.set(true);
    try {
      const [tipos, obras] = await Promise.all([
        this.service.tipos().catch(() => [] as ReunionTipo[]),
        this.service.obras().catch(() => [] as { id: string; nombre: string }[]),
      ]);
      this.tipos.set(tipos);
      if (tipos.length) this.tipoId.set(tipos[0].id);
      this.obras.set(obras);
    } finally {
      this.cargando.set(false);
    }
  }

  onPartTerm(v: string): void {
    this.partTerm.set(v);
    if (this.partDebounce) clearTimeout(this.partDebounce);
    const t = v.trim();
    if (t.length < 2) {
      this.partResultados.set([]);
      return;
    }
    this.partDebounce = setTimeout(() => void this.buscarParticipantes(t), 300);
  }

  private async buscarParticipantes(t: string): Promise<void> {
    this.partBuscando.set(true);
    try {
      const yaElegidos = new Set(this.partElegidos().map((u) => u.id));
      const res = await this.service.buscarUsuarios(t);
      this.partResultados.set(res.filter((u) => !yaElegidos.has(u.id)));
    } finally {
      this.partBuscando.set(false);
    }
  }

  elegirParticipante(u: UsuarioBusqueda): void {
    this.partElegidos.update((list) => (list.some((x) => x.id === u.id) ? list : [...list, u]));
    this.partResultados.set([]);
    this.partTerm.set('');
  }

  quitarParticipante(u: UsuarioBusqueda): void {
    this.partElegidos.update((list) => list.filter((x) => x.id !== u.id));
  }

  async guardar(): Promise<void> {
    if (!this.puedeGuardar()) return;
    this.guardando.set(true);
    try {
      const inicio = new Date(`${this.fecha()}T${this.horaInicio()}:00`);
      const fin = new Date(`${this.fecha()}T${this.horaFin()}:00`);
      if (fin <= inicio) {
        this.toast.error(this.i18n.t('La hora de fin debe ser después del inicio.'));
        return;
      }
      const id = await this.service.crear({
        tipoId: this.tipoId(),
        titulo: this.titulo().trim(),
        inicio: inicio.toISOString(),
        fin: fin.toISOString(),
        modalidad: this.modalidad(),
        lugar: this.lugar().trim() || null,
        proyectoId: this.proyectoId() || null,
        participantesUsuarios: this.partElegidos().map((u) => u.id),
      });
      this.toast.success(this.i18n.t('Reunión creada.'));
      void this.router.navigate(['/reuniones', id], { replaceUrl: true });
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo crear la reunión.'));
    } finally {
      this.guardando.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
