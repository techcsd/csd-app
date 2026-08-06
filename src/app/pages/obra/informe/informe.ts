import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { ObraService } from '../../../core/services/obra.service';

interface Informe {
  id: string;
  periodo_inicio: string | null;
  periodo_fin: string | null;
  estado: string;
  secciones: Record<string, unknown> | null;
  campos_manuales: Record<string, unknown> | null;
}

/** Lunes..domingo de la semana de una fecha. */
function semanaDe(base: Date): { inicio: string; fin: string } {
  const d = new Date(base);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - dow);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);
  return { inicio: lunes.toISOString().slice(0, 10), fin: domingo.toISOString().slice(0, 10) };
}

/** AG16 FASE 5 — Informe semanal de obra: revisar auto-compilado + secciones manuales + enviar. */
@Component({
  selector: 'app-obra-informe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState],
  templateUrl: './informe.html',
  styleUrl: './informe.scss',
})
export class InformePage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private location = inject(Location);

  proyectoId = '';
  loading = signal(true);
  vista = signal<'lista' | 'detalle'>('lista');
  informes = signal<Informe[]>([]);
  activo = signal<Informe | null>(null);
  generando = signal(false);
  guardando = signal(false);
  enviando = signal(false);

  // Campos manuales
  problemas = signal('');
  decisiones = signal('');
  necesidades = signal('');
  borradorPrevio = signal(false);
  private hydrated = false;

  private claveDe(id: string): string {
    return `obra_informe:${id}`;
  }

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.cargar();
    // AE9 — borrador local de las secciones manuales (no se pierde por una llamada).
    effect(() => {
      const inf = this.activo();
      const snap = { problemas: this.problemas(), decisiones: this.decisiones(), necesidades: this.necesidades() };
      if (!this.hydrated || !inf || inf.estado === 'enviado' || this.vista() !== 'detalle') return;
      this.autosave.queue(this.claveDe(inf.id), snap, { tipo: 'obra_informe', etiqueta: 'Informe semanal', ruta: this.location.path() });
    });
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.informes.set((await this.obra.informesDeObra(this.proyectoId)) as unknown as Informe[]);
    } finally {
      this.loading.set(false);
    }
  }

  sec(k: string): unknown {
    return this.activo()?.secciones?.[k];
  }

  async generar(): Promise<void> {
    if (this.generando()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para generar el informe.');
      return;
    }
    this.generando.set(true);
    try {
      const { inicio, fin } = semanaDe(new Date());
      const id = await this.obra.compilarInforme(this.proyectoId, inicio, fin);
      await this.cargar();
      const inf = this.informes().find((i) => i.id === id) ?? null;
      if (inf) this.abrir(inf);
      else this.toast.error('No se pudo abrir el informe generado.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo generar el informe.');
    } finally {
      this.generando.set(false);
    }
  }

  async abrir(inf: Informe): Promise<void> {
    this.hydrated = false;
    this.activo.set(inf);
    const m = inf.campos_manuales ?? {};
    this.problemas.set((m['problemas_criticos'] as string) ?? '');
    this.decisiones.set((m['decisiones'] as string) ?? '');
    this.necesidades.set((m['necesidades'] as string) ?? '');
    this.borradorPrevio.set(false);
    // AE9 — si hay un borrador local sin guardar (más nuevo que lo guardado en el
    // servidor), lo recuperamos para no perder lo escrito por una interrupción.
    if (inf.estado !== 'enviado') {
      const draft = await this.borrador.load<{ problemas: string; decisiones: string; necesidades: string }>(this.claveDe(inf.id));
      if (draft) {
        this.problemas.set(draft.problemas ?? this.problemas());
        this.decisiones.set(draft.decisiones ?? this.decisiones());
        this.necesidades.set(draft.necesidades ?? this.necesidades());
        this.borradorPrevio.set(true);
      }
    }
    this.vista.set('detalle');
    this.hydrated = true;
  }

  volver(): void {
    this.hydrated = false;
    this.vista.set('lista');
    this.activo.set(null);
    this.borradorPrevio.set(false);
  }

  async guardarManual(): Promise<void> {
    const inf = this.activo();
    if (!inf || this.guardando()) return;
    this.guardando.set(true);
    try {
      await this.obra.guardarInformeManual(
        inf.id,
        { problemas_criticos: this.problemas().trim(), decisiones: this.decisiones().trim(), necesidades: this.necesidades().trim() },
        null,
      );
      await this.autosave.discard(this.claveDe(inf.id));
      this.borradorPrevio.set(false);
      this.toast.success('Secciones guardadas.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.guardando.set(false);
    }
  }

  async enviar(): Promise<void> {
    const inf = this.activo();
    if (!inf || this.enviando()) return;
    this.enviando.set(true);
    try {
      await this.guardarManual();
      await this.obra.enviarInforme(inf.id);
      this.toast.success('Informe enviado a Gerencia.');
      await this.cargar();
      this.volver();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar el informe.');
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    void this.router.navigate(['/obra']);
  }
}
