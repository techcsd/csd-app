import { ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { UserContextService } from '../../core/services/user-context.service';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { MOTION_DIRECTIVES } from '../../shared/motion';
import { construirIndiceBuscador } from '../../core/buscador/buscador-indice';
import { buscarEnIndice, normalizarTexto, IndiceBuscadorEntry, ResultadoBusqueda } from '../../core/buscador/buscador-coincidencia.util';
import { cargarRecientesIds, guardarRecienteId } from '../../core/buscador/recientes.util';

/** Una fila pintable (resultado real o reciente — recientes no traen rangos). */
interface FilaBuscador {
  entrada: IndiceBuscadorEntry;
  resaltar: Array<[number, number]>;
}

function sinResaltar(entrada: IndiceBuscadorEntry): FilaBuscador {
  return { entrada, resaltar: [] };
}

/**
 * DG2 — buscador compacto: lupa en la cabecera de Home → esta pantalla completa.
 * Reusa el mismo índice/gating que Home (`construirIndiceBuscador`) y el mismo
 * algoritmo de coincidencia del buscador maestro de la web (paridad de matching:
 * sin acentos, palabras sueltas en cualquier orden, 1-2 letras de tolerancia).
 */
@Component({
  selector: 'app-buscador',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './buscador.html',
  styleUrl: './buscador.scss',
})
export class BuscadorPage implements OnInit {
  private ctx = inject(UserContextService);
  private i18n = inject(I18nService);
  private router = inject(Router);
  private location = inject(Location);

  private campoInput = viewChild<ElementRef<HTMLInputElement>>('campo');

  query = signal('');
  private recientesIds = signal<string[]>([]);
  private indice = signal<IndiceBuscadorEntry[]>([]);

  private storage(): Storage | undefined {
    try {
      return typeof localStorage !== 'undefined' ? localStorage : undefined;
    } catch {
      return undefined;
    }
  }

  hayTexto = computed(() => normalizarTexto(this.query()).length > 0);

  private resultados = computed<ResultadoBusqueda[]>(() => {
    const q = this.query();
    if (!normalizarTexto(q)) return [];
    return buscarEnIndice(q, this.indice(), 12);
  });

  recientes = computed<FilaBuscador[]>(() => {
    const porRuta = new Map(this.indice().map((e) => [e.ruta, e]));
    return this.recientesIds()
      .map((ruta) => porRuta.get(ruta))
      .filter((e): e is IndiceBuscadorEntry => !!e)
      .map(sinResaltar);
  });

  filas = computed<FilaBuscador[]>(() =>
    this.hayTexto() ? this.resultados().map((r) => ({ entrada: r.entrada, resaltar: r.resaltar })) : [],
  );

  sinResultados = computed(() => this.hayTexto() && this.filas().length === 0);

  ngOnInit(): void {
    this.indice.set(construirIndiceBuscador(this.ctx, this.i18n));
    this.recientesIds.set(cargarRecientesIds(this.storage()));
    queueMicrotask(() => this.campoInput()?.nativeElement.focus());
  }

  onQueryChange(v: string): void {
    this.query.set(v);
  }

  /** Parte `fila.entrada.camino` en segmentos para pintar `<mark>` donde matcheó. */
  segmentos(fila: FilaBuscador): { texto: string; marcado: boolean }[] {
    const camino = fila.entrada.camino;
    const rangos = fila.resaltar;
    if (!rangos.length) return [{ texto: camino, marcado: false }];
    const out: { texto: string; marcado: boolean }[] = [];
    let cursor = 0;
    for (const [inicio, fin] of rangos) {
      if (inicio < cursor || inicio >= camino.length) continue;
      if (inicio > cursor) out.push({ texto: camino.slice(cursor, inicio), marcado: false });
      out.push({ texto: camino.slice(inicio, fin), marcado: true });
      cursor = fin;
    }
    if (cursor < camino.length) out.push({ texto: camino.slice(cursor), marcado: false });
    return out;
  }

  elegir(fila: FilaBuscador): void {
    this.recientesIds.set(guardarRecienteId(this.storage(), fila.entrada.ruta));
    void this.router.navigateByUrl(fila.entrada.ruta);
  }

  back(): void {
    this.location.back();
  }
}
