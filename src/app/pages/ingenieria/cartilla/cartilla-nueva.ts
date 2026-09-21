import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { FiguraAcero } from '../../../shared/ui/figura-acero/figura-acero';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { CartillaService } from '../../../core/services/cartilla.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { fechaLocalISO } from '../../../core/util/fecha';
import { Proyecto } from '../../../core/models/bitacora.model';
import {
  AceroDiametro,
  CartillaAtadoCaptura,
  CartillaFigura,
  CartillaPiezaCaptura,
} from '../../../shared/models/cartilla.model';

type Paso = 'obra' | 'fecha' | 'atados' | 'fotos' | 'resumen';
const PASOS: Paso[] = ['obra', 'fecha', 'atados', 'fotos', 'resumen'];

/** BO10 — cuántos tramos (lados) capturar por figura. */
const TRAMOS_POR_FIGURA: Record<string, number> = {
  recta: 1,
  l: 2,
  u: 3,
  estribo: 4,
  gancho: 2,
  z: 3,
};

/**
 * BO10 — captura de una cartilla de acero: obra → fecha (BL9, elegible) → atados
 * (cada uno con sus piezas: marca, diámetro, figura, tramos en cm, cantidad, con
 * peso en vivo) → fotos de la cartilla física (+ plano opcional) → resumen. Offline
 * por outbox (CartillaService). Un borrador se persiste para retomar.
 */
@Component({
  selector: 'app-cartilla-nueva',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, OptionButton, PhotoSlot, Skeleton, FiguraAcero, TranslatePipe],
  templateUrl: './cartilla-nueva.html',
  styleUrl: './cartilla-nueva.scss',
})
export class CartillaNuevaPage {
  private service = inject(CartillaService);
  private borrador = inject(BorradorService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private i18n = inject(I18nService);

  private readonly claveBorrador: string;

  paso = signal<Paso>('obra');
  pasos = PASOS;
  cargando = signal(true);
  enviando = signal(false);
  online = this.network.online;
  hoy = fechaLocalISO();

  proyectos = signal<Proyecto[]>([]);
  diametros = signal<AceroDiametro[]>([]);
  figuras = signal<CartillaFigura[]>([]);

  proyectoId = signal<string>('');
  fecha = signal<string>(fechaLocalISO());
  notas = signal<string>('');
  atados = signal<CartillaAtadoCaptura[]>([]);
  fotos = signal<CapturedPhoto[]>([]);
  plano = signal<CapturedPhoto | null>(null);

  // Atado en edición (índice) y borrador de pieza.
  atadoAbierto = signal<number | null>(null);
  piezaMarca = signal('');
  piezaDiametro = signal('');
  piezaFigura = signal('');
  piezaTramos = signal<number[]>([]);
  piezaCantidad = signal<number>(1);

  pasoIndex = computed(() => PASOS.indexOf(this.paso()) + 1);
  totalPasos = PASOS.length;
  fechaEsPasada = computed(() => this.fecha() < this.hoy);
  obraNombre = computed(() => this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? '');

  /** kg/m del diámetro elegido en la pieza en edición. */
  private kgPorM(codigo: string): number {
    return this.diametros().find((d) => d.codigo === codigo)?.kg_por_m ?? 0;
  }

  /** Peso en vivo de la pieza en edición (kg). */
  pesoPiezaVivo = computed(() => this.pesoDe(this.piezaDiametro(), this.piezaTramos(), this.piezaCantidad()));

  private pesoDe(diametro: string, tramos: number[], cantidad: number): number {
    const totalCm = tramos.reduce((s, t) => s + (t || 0), 0);
    return (totalCm / 100) * this.kgPorM(diametro) * (cantidad || 0);
  }

  /** Peso total de la cartilla (kg). */
  pesoTotal = computed(() =>
    this.atados().reduce(
      (s, a) => s + a.piezas.reduce((sp, p) => sp + this.pesoDe(p.diametro_codigo, p.tramos_cm.map((t) => t.cm), p.cantidad), 0),
      0,
    ),
  );

  /** Resumen de kg por diámetro. */
  resumenPorDiametro = computed(() => {
    const map = new Map<string, number>();
    for (const a of this.atados()) {
      for (const p of a.piezas) {
        const kg = this.pesoDe(p.diametro_codigo, p.tramos_cm.map((t) => t.cm), p.cantidad);
        map.set(p.diametro_codigo, (map.get(p.diametro_codigo) ?? 0) + kg);
      }
    }
    return [...map.entries()].map(([diametro, kg]) => ({ diametro, kg }));
  });

  constructor() {
    this.claveBorrador = this.route.snapshot.queryParamMap.get('borrador') ?? `cartilla_${crypto.randomUUID()}`;
    void this.init();
  }

  private async init(): Promise<void> {
    this.cargando.set(true);
    try {
      const [proyectos, diametros, figuras] = await Promise.all([
        this.service.getProyectos(),
        this.service.diametros(),
        this.service.figuras(),
      ]);
      this.proyectos.set(proyectos);
      this.diametros.set(diametros);
      this.figuras.set(figuras);
      await this.rehidratarBorrador();
    } catch {
      this.toast.error(this.i18n.t('No pudimos cargar los catálogos. Revisa tu conexión.'));
    } finally {
      this.cargando.set(false);
    }
  }

  private async rehidratarBorrador(): Promise<void> {
    const data = await this.borrador.load<{
      proyectoId: string; fecha: string; notas: string; atados: CartillaAtadoCaptura[];
    }>(this.claveBorrador);
    if (!data) return;
    this.proyectoId.set(data.proyectoId ?? '');
    this.fecha.set(data.fecha || fechaLocalISO());
    this.notas.set(data.notas ?? '');
    this.atados.set(data.atados ?? []);
    // BT4 — recupera también las fotos + el plano ya tomados (antes se re-tomaban).
    const fotos = await this.borrador.loadFotos(this.claveBorrador);
    if (fotos.length) {
      const planoF = fotos.find((f) => f.slot === 'plano');
      if (planoF) this.plano.set({ blob: planoF.blob, previewUrl: URL.createObjectURL(planoF.blob) });
      const arr = fotos
        .filter((f) => f.slot !== 'plano')
        .sort((a, b) => Number(a.slot) - Number(b.slot))
        .map((f) => ({ blob: f.blob, previewUrl: URL.createObjectURL(f.blob) }));
      if (arr.length) this.fotos.set(arr);
    }
  }

  /** BT4 — re-persiste todas las fotos (índice) + el plano en el borrador. */
  private async persistFotos(): Promise<void> {
    try {
      await this.borrador.clearFotos(this.claveBorrador);
      const fs = this.fotos();
      for (let i = 0; i < fs.length; i++) await this.borrador.saveFoto(this.claveBorrador, String(i), fs[i].blob);
      const p = this.plano();
      if (p) await this.borrador.saveFoto(this.claveBorrador, 'plano', p.blob);
      this.guardarBorrador(); // asegura la fila de datos también
    } catch {
      /* persistir la foto nunca debe romper la captura */
    }
  }

  private guardarBorrador(): void {
    void this.borrador.save(
      this.claveBorrador,
      {
        proyectoId: this.proyectoId(),
        fecha: this.fecha(),
        notas: this.notas(),
        atados: this.atados(),
      },
      {
        tipo: 'cartilla',
        etiqueta: `${this.i18n.t('Cartilla')} · ${this.obraNombre() || this.i18n.t('sin obra')}`,
        ruta: '/ingenieria/cartilla/nueva',
      },
    );
  }

  // ── navegación ──────────────────────────────────────────────────────────────
  private idx(): number {
    return PASOS.indexOf(this.paso());
  }

  siguiente(): void {
    if (!this.validarPaso()) return;
    this.guardarBorrador();
    const next = PASOS[Math.min(this.idx() + 1, PASOS.length - 1)];
    this.paso.set(next);
  }

  anterior(): void {
    if (this.idx() === 0) {
      this.location.back();
      return;
    }
    this.paso.set(PASOS[this.idx() - 1]);
  }

  private validarPaso(): boolean {
    switch (this.paso()) {
      case 'obra':
        if (!this.proyectoId()) {
          this.toast.error(this.i18n.t('Elige la obra.'));
          return false;
        }
        return true;
      case 'fecha':
        if (!this.fecha()) {
          this.toast.error(this.i18n.t('Elige la fecha.'));
          return false;
        }
        return true;
      case 'atados':
        if (!this.atados().length || this.atados().every((a) => !a.piezas.length)) {
          this.toast.error(this.i18n.t('Agrega al menos un atado con una pieza.'));
          return false;
        }
        return true;
      case 'fotos':
        if (!this.fotos().length) {
          this.toast.error(this.i18n.t('Toma al menos una foto de la cartilla.'));
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  elegirObra(id: string): void {
    this.proyectoId.set(id);
  }

  // ── atados ────────────────────────────────────────────────────────────────
  agregarAtado(): void {
    this.atados.update((list) => [
      ...list,
      { identificador: '', elemento: '', cantidad_piezas: 0, piezas: [] },
    ]);
    this.atadoAbierto.set(this.atados().length - 1);
    this.resetPieza();
  }

  abrirAtado(i: number): void {
    this.atadoAbierto.set(this.atadoAbierto() === i ? null : i);
    this.resetPieza();
  }

  quitarAtado(i: number): void {
    this.atados.update((list) => list.filter((_, k) => k !== i));
    if (this.atadoAbierto() === i) this.atadoAbierto.set(null);
    this.guardarBorrador();
  }

  setAtadoCampo(i: number, campo: 'identificador' | 'elemento', valor: string): void {
    this.atados.update((list) => list.map((a, k) => (k === i ? { ...a, [campo]: valor } : a)));
  }

  // ── pieza en edición ────────────────────────────────────────────────────────
  private resetPieza(): void {
    this.piezaMarca.set('');
    this.piezaDiametro.set('');
    this.piezaFigura.set('');
    this.piezaTramos.set([]);
    this.piezaCantidad.set(1);
  }

  elegirDiametro(codigo: string): void {
    this.piezaDiametro.set(codigo);
  }

  elegirFigura(codigo: string): void {
    this.piezaFigura.set(codigo);
    const n = TRAMOS_POR_FIGURA[codigo] ?? 1;
    this.piezaTramos.set(Array.from({ length: n }, (_, i) => this.piezaTramos()[i] ?? 0));
  }

  setTramo(i: number, valor: number): void {
    this.piezaTramos.update((t) => t.map((v, k) => (k === i ? Math.max(0, valor || 0) : v)));
  }

  ladoLabel(i: number): string {
    return String.fromCharCode(65 + i); // A, B, C…
  }

  agregarPieza(): void {
    const atadoIdx = this.atadoAbierto();
    if (atadoIdx === null) return;
    if (!this.piezaDiametro()) {
      this.toast.error(this.i18n.t('Elige el diámetro.'));
      return;
    }
    if (!this.piezaFigura()) {
      this.toast.error(this.i18n.t('Elige la figura.'));
      return;
    }
    if (this.piezaTramos().some((t) => !t || t <= 0)) {
      this.toast.error(this.i18n.t('Escribe la medida de cada lado (cm).'));
      return;
    }
    const pieza: CartillaPiezaCaptura = {
      marca: this.piezaMarca().trim(),
      diametro_codigo: this.piezaDiametro(),
      figura_codigo: this.piezaFigura(),
      tramos_cm: this.piezaTramos().map((cm, i) => ({ lado: this.ladoLabel(i), cm })),
      cantidad: Math.max(1, this.piezaCantidad() || 1),
    };
    this.atados.update((list) =>
      list.map((a, k) =>
        k === atadoIdx ? { ...a, piezas: [...a.piezas, pieza], cantidad_piezas: a.piezas.length + 1 } : a,
      ),
    );
    this.resetPieza();
    this.guardarBorrador();
  }

  quitarPieza(atadoIdx: number, piezaIdx: number): void {
    this.atados.update((list) =>
      list.map((a, k) =>
        k === atadoIdx
          ? { ...a, piezas: a.piezas.filter((_, p) => p !== piezaIdx), cantidad_piezas: Math.max(0, a.piezas.length - 1) }
          : a,
      ),
    );
    this.guardarBorrador();
  }

  pesoPieza(p: CartillaPiezaCaptura): number {
    return this.pesoDe(p.diametro_codigo, p.tramos_cm.map((t) => t.cm), p.cantidad);
  }

  // ── fotos ─────────────────────────────────────────────────────────────────
  agregarFoto(foto: CapturedPhoto): void {
    this.fotos.update((f) => [...f, foto]);
    void this.persistFotos(); // BT4
  }
  quitarFoto(i: number): void {
    this.fotos.update((f) => f.filter((_, k) => k !== i));
    void this.persistFotos(); // BT4
  }
  agregarPlano(foto: CapturedPhoto): void {
    this.plano.set(foto);
    void this.persistFotos(); // BT4
  }
  quitarPlano(): void {
    this.plano.set(null);
    void this.persistFotos(); // BT4
  }

  // ── enviar ──────────────────────────────────────────────────────────────────
  async enviar(): Promise<void> {
    if (this.enviando()) return;
    if (!this.validarPaso()) return;
    this.enviando.set(true);
    try {
      await this.service.enqueueCartilla({
        proyectoId: this.proyectoId(),
        fecha: this.fecha(),
        atados: this.atados(),
        notas: this.notas().trim() || null,
        fotos: this.fotos().map((f) => f.blob),
        plano: this.plano()?.blob ?? null,
        esPrueba: this.ctx.esPrueba(),
      });
      await this.borrador.clear(this.claveBorrador);
      this.toast.success(
        this.online()
          ? this.i18n.t('¡Cartilla enviada! Oficina la revisará.')
          : this.i18n.t('Guardada. Sin señal, se enviará sola.'),
      );
      void this.router.navigate(['/ingenieria/cartilla']);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo enviar. Intenta de nuevo.'));
    } finally {
      this.enviando.set(false);
    }
  }

  back(): void {
    this.anterior();
  }
}
