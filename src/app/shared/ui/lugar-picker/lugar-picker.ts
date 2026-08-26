import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LugaresService, LugarSistema } from '../../../core/services/lugares.service';
import { GeocodingService, LinkResolveError } from '../../../core/services/geocoding.service';

/**
 * BA/Transporte v3 (FASE 3) — lugar seleccionado. Forma normalizada que consume
 * el conduce externo / crear ruta. Un lugar en TEXTO libre («Otros») no lleva
 * coordenadas: el servidor lo manda a la bandeja "Lugares por registrar".
 */
export interface LugarSel {
  tipo: 'obra' | 'almacen' | 'lugar' | 'coord' | 'texto';
  id?: string | null; // id de obra/almacén/POI del sistema
  nombre: string; // etiqueta legible / texto libre
  lat?: number | null;
  lng?: number | null;
  proyecto_id?: string | null; // cuando tipo='obra'
  bodega_id?: string | null; // cuando tipo='almacen'
}

interface Resultado {
  origen: 'sistema' | 'mapa';
  tipo: LugarSel['tipo'];
  nombre: string;
  detalle?: string | null;
  id?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Selector de lugar con la cadena completa de Transporte v3, para que el usuario
 * NUNCA se quede trancado (spec §03): buscador mejorado (lugares del sistema +
 * mapa) → link de Google Maps (parser AU16) → «Otros»: texto libre. En origen y
 * destino, mismo componente (conduce externo, y por extensión crear ruta).
 */
@Component({
  selector: 'app-lugar-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './lugar-picker.html',
  styleUrl: './lugar-picker.scss',
})
export class LugarPicker {
  private lugares = inject(LugaresService);
  private geo = inject(GeocodingService);

  label = input<string>('Lugar');
  placeholder = input<string>('Buscar obra, almacén o lugar…');

  /** Emite el lugar elegido (o null al limpiar). */
  picked = output<LugarSel | null>();

  q = signal('');
  resultados = signal<Resultado[]>([]);
  buscando = signal(false);
  errorBusqueda = signal('');
  seleccionado = signal<LugarSel | null>(null);

  // Modo link de Google Maps
  modoLink = signal(false);
  link = signal('');
  resolviendoLink = signal(false);
  errorLink = signal('');

  // Modo «Otros» (texto libre)
  modoOtros = signal(false);
  otroTexto = signal('');

  private debounce?: ReturnType<typeof setTimeout>;
  private busquedaSeq = 0;

  hayTexto = computed(() => this.q().trim().length >= 2);

  /** Debounced: busca en paralelo lugares del sistema + mapa (Nominatim). */
  onBuscar(v: string): void {
    this.q.set(v);
    this.errorBusqueda.set('');
    if (this.debounce) clearTimeout(this.debounce);
    if (v.trim().length < 2) {
      this.resultados.set([]);
      return;
    }
    this.debounce = setTimeout(() => void this.ejecutarBusqueda(v.trim()), 350);
  }

  private async ejecutarBusqueda(term: string): Promise<void> {
    const seq = ++this.busquedaSeq;
    this.buscando.set(true);
    try {
      // Sistema primero (obras/almacenes/POIs), luego mapa — en paralelo.
      const [sistema, mapa] = await Promise.all([
        this.lugares.buscar(term),
        this.geo.buscar(term).catch(() => []),
      ]);
      if (seq !== this.busquedaSeq) return; // búsqueda obsoleta
      const rSistema: Resultado[] = sistema.map((s: LugarSistema) => ({
        origen: 'sistema',
        tipo: s.tipo,
        nombre: s.nombre,
        detalle: s.detalle,
        id: s.id,
        lat: s.lat,
        lng: s.lng,
      }));
      const rMapa: Resultado[] = mapa.map((m) => ({
        origen: 'mapa',
        tipo: 'coord',
        nombre: m.nombre,
        lat: m.latitud,
        lng: m.longitud,
      }));
      this.resultados.set([...rSistema, ...rMapa]);
    } catch {
      if (seq === this.busquedaSeq) this.errorBusqueda.set('No se pudo buscar. Usa el link o «Otros».');
    } finally {
      if (seq === this.busquedaSeq) this.buscando.set(false);
    }
  }

  elegir(r: Resultado): void {
    const sel: LugarSel = {
      tipo: r.tipo,
      id: r.id ?? null,
      nombre: r.nombre,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      proyecto_id: r.tipo === 'obra' ? (r.id ?? null) : null,
      bodega_id: r.tipo === 'almacen' ? (r.id ?? null) : null,
    };
    this.aplicar(sel);
  }

  abrirLink(): void {
    this.modoLink.set(true);
    this.modoOtros.set(false);
    this.errorLink.set('');
  }

  async resolverLink(): Promise<void> {
    const entrada = this.link().trim();
    if (!entrada) return;
    this.resolviendoLink.set(true);
    this.errorLink.set('');
    try {
      const r = await this.geo.resolverLink(entrada);
      this.aplicar({ tipo: 'coord', nombre: r.direccion || 'Ubicación del link', lat: r.lat, lng: r.lng });
    } catch (e) {
      // AU16 — si el link trae un nombre sugerido, precarga el buscador (no tranca).
      const err = e as LinkResolveError;
      if (err.suggestQuery) {
        this.modoLink.set(false);
        this.onBuscar(err.suggestQuery);
      }
      this.errorLink.set(err.message || 'No se pudo resolver el link. Prueba «Otros».');
    } finally {
      this.resolviendoLink.set(false);
    }
  }

  abrirOtros(): void {
    this.modoOtros.set(true);
    this.modoLink.set(false);
    // Arrastra lo ya escrito en el buscador como punto de partida.
    if (this.q().trim() && !this.otroTexto().trim()) this.otroTexto.set(this.q().trim());
  }

  confirmarOtros(): void {
    const texto = this.otroTexto().trim();
    if (!texto) return;
    // Texto libre = sin coordenadas → el servidor lo manda a "Lugares por registrar".
    this.aplicar({ tipo: 'texto', nombre: texto });
  }

  private aplicar(sel: LugarSel): void {
    this.seleccionado.set(sel);
    this.resultados.set([]);
    this.modoLink.set(false);
    this.modoOtros.set(false);
    this.link.set('');
    this.otroTexto.set('');
    this.picked.emit(sel);
  }

  limpiar(): void {
    this.seleccionado.set(null);
    this.q.set('');
    this.resultados.set([]);
    this.picked.emit(null);
  }

  /** Icono por tipo para la fila de resultado. */
  icono(tipo: LugarSel['tipo']): string {
    switch (tipo) {
      case 'obra': return '🏗';
      case 'almacen': return '🏭';
      case 'lugar': return '📍';
      case 'coord': return '🗺';
      default: return '✏️';
    }
  }
}
