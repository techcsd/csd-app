import { computed, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from '../services/supabase.service';
import { UserContextService } from '../services/user-context.service';
import {
  PracticaIntentoFila,
  PracticaMision,
  PracticaResultado,
  PracticaResultadoLinea,
} from './practica.models';
import { MISIONES_APP, misionPorId } from './misiones-app';

/**
 * CM7 (PROMPT-95 F6a) — motor del modo práctica (simulador local).
 *
 * **Aislamiento:** este servicio NO usa el outbox, ni borradores, ni ningún servicio
 * real. Lo ÚNICO que sale a la red es `practica_guardar_intento` (guardar la nota) y
 * `practica_resultados_persona` (leer "Mis resultados"). Las "escrituras" y "fotos"
 * del ensayo viven en memoria y se descartan al salir. Push/GPS/tracking no se tocan
 * (la práctica es solo una pantalla con estado local). Así se cumple el candado de red
 * sin interceptar: no hay a quién interceptar.
 */
@Injectable({ providedIn: 'root' })
export class PracticaService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);

  // ── Estado del ensayo en curso ────────────────────────────────────────────────
  readonly mision = signal<PracticaMision | null>(null);
  readonly pasoIdx = signal(0);
  readonly objetivosHechos = signal<Set<string>>(new Set());
  readonly penalizaciones = signal<Set<string>>(new Set());
  readonly resultado = signal<PracticaResultado | null>(null);
  /** Segundos transcurridos (lo actualiza un intervalo mientras hay misión). */
  readonly segundos = signal(0);
  /** El paso 'valor' con trampa: true = ya metió el valor malo y debe corregir. */
  readonly corrigiendo = signal(false);
  /** Temblor puntual (el error de km): la UI lo observa para la animación. */
  readonly temblorAt = signal(0);

  private inicioMs = 0;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private fotosTomadas = new Set<string>();
  private valores = new Map<string, string>();

  /** Misiones visibles para el usuario actual: admin ve todas; el resto, las de su
   *  rol (o las sin rol = para todos). */
  misionesVisibles(): PracticaMision[] {
    if (this.ctx.hasRol('admin')) return MISIONES_APP;
    const set = new Set(this.ctx.roles());
    return MISIONES_APP.filter((m) => !m.roles.length || m.roles.some((r) => set.has(r)));
  }

  /** Paso actual (o null si terminó). */
  readonly pasoActual = computed(() => this.mision()?.pasos[this.pasoIdx()] ?? null);

  /** Valor mostrado en el campo del paso actual (en vivo). */
  valorDe(objetivo: string): string {
    return this.valores.get(objetivo) ?? '';
  }
  /** ¿La foto de ese objetivo ya se "tomó"? */
  fotoHecha(objetivo: string): boolean {
    return this.fotosTomadas.has(objetivo);
  }
  objetivoHecho(id: string): boolean {
    return this.objetivosHechos().has(id);
  }

  /** Arranca una misión desde cero. */
  iniciar(mision: PracticaMision): void {
    this.detenerTimer();
    this.mision.set(mision);
    this.pasoIdx.set(0);
    this.objetivosHechos.set(new Set());
    this.penalizaciones.set(new Set());
    this.resultado.set(null);
    this.corrigiendo.set(false);
    this.fotosTomadas = new Set();
    this.valores = new Map();
    this.segundos.set(0);
    this.inicioMs = Date.now();
    this.intervalo = setInterval(() => {
      this.segundos.set(Math.floor((Date.now() - this.inicioMs) / 1000));
    }, 1000);
  }

  reiniciar(): void {
    const m = this.mision();
    if (m) this.iniciar(m);
  }

  /** Procesa el paso actual y avanza (o termina). Devuelve el resultado si terminó. */
  avanzar(): void {
    const m = this.mision();
    const paso = this.pasoActual();
    if (!m || !paso) return;

    if (paso.tipo === 'valor' && paso.campo) {
      const c = paso.campo;
      // Trampa: primer avance mete el valor malo (error + penalización); el 2º corrige.
      if (c.trampa && !this.corrigiendo()) {
        this.valores.set(c.objetivo, c.trampa.valorMalo);
        this.penalizaciones.update((s) => new Set(s).add(c.trampa!.penalizacionId));
        this.corrigiendo.set(true);
        this.temblorAt.set(Date.now()); // dispara el temblor en la UI
        return; // no avanza: debe corregir
      }
      this.valores.set(c.objetivo, c.valor);
      this.marcarObjetivo(c.objetivo);
      this.corrigiendo.set(false);
    } else if (paso.tipo === 'foto' && paso.foto) {
      this.fotosTomadas.add(paso.foto.objetivo);
      this.marcarObjetivo(paso.foto.objetivo);
    } else if (paso.tipo === 'accion' && paso.accion) {
      this.marcarObjetivo(paso.accion.objetivo);
    }

    const next = this.pasoIdx() + 1;
    if (next >= m.pasos.length) {
      void this.terminar();
    } else {
      this.pasoIdx.set(next);
    }
  }

  private marcarObjetivo(id: string): void {
    this.objetivosHechos.update((s) => new Set(s).add(id));
  }

  /** Calcula la nota, guarda el intento y publica el resultado. */
  private async terminar(): Promise<void> {
    this.detenerTimer();
    const m = this.mision();
    if (!m) return;
    const dur = Math.max(1, Math.round((Date.now() - this.inicioMs) / 1000));
    const res = this.evaluar(m, dur);
    this.resultado.set(res);
    await this.guardar(m, res).catch(() => {
      /* best-effort: si no se pudo guardar la nota, el resultado igual se muestra */
    });
  }

  /** Puntos por reglas cumplidas (objetivos hechos) + bono de tiempo − penalizaciones. */
  private evaluar(m: PracticaMision, durS: number): PracticaResultado {
    const lineas: PracticaResultadoLinea[] = [];
    const r = m.reglas;
    const hechos = this.objetivosHechos();

    for (const regla of r.puntos) {
      const ok = !regla.objetivos?.length || regla.objetivos.every((o) => hechos.has(o));
      lineas.push({ ok, label: regla.label, puntos: ok ? regla.puntos : 0 });
    }
    if (r.tiempo) {
      const aTiempo = durS <= r.tiempo.tiempoBonoSegundos;
      lineas.push({ ok: aTiempo, label: r.tiempo.label, puntos: aTiempo ? r.tiempo.puntos : 0 });
    }
    for (const pen of r.penalizaciones) {
      if (this.penalizaciones().has(pen.id)) {
        lineas.push({ ok: false, label: pen.label, puntos: pen.puntos });
      }
    }

    const nota = Math.max(0, Math.min(100, lineas.reduce((acc, l) => acc + l.puntos, 0)));
    const aprobada = nota >= m.aprobarDesde;
    const estrellas = nota >= 95 ? 3 : nota >= m.aprobarDesde ? 2 : nota >= 50 ? 1 : 0;
    return { nota, estrellas, aprobada, duracionS: durS, lineas };
  }

  /** Guarda la nota del intento (la ÚNICA escritura real de la práctica). */
  private async guardar(m: PracticaMision, res: PracticaResultado): Promise<void> {
    const { error } = await this.supabase.client.rpc('practica_guardar_intento', {
      p_mision_id: m.id,
      p_nota: res.nota,
      p_estrellas: res.estrellas,
      p_aprobada: res.aprobada,
      p_duracion_s: res.duracionS,
      p_detalle: { lineas: res.lineas },
      p_plataforma: 'app',
      p_version: m.version,
    });
    if (error) throw new Error(error.message);
  }

  /** "Mis resultados": los intentos del usuario actual. */
  async misResultados(): Promise<PracticaIntentoFila[]> {
    const { data, error } = await this.supabase.client.rpc('practica_resultados_persona', {
      p_usuario_id: this.ctx.profile()?.id ?? null,
    });
    if (error) throw new Error(error.message);
    return (data as PracticaIntentoFila[]) ?? [];
  }

  /** Roles (códigos) del usuario actual, para filtrar las misiones visibles. */
  misRoles(): string[] {
    return this.ctx.roles();
  }

  /** Sale de la práctica y descarta todo el estado en memoria. */
  salir(): void {
    this.detenerTimer();
    this.mision.set(null);
    this.resultado.set(null);
    this.fotosTomadas = new Set();
    this.valores = new Map();
  }

  misionPorId = misionPorId;

  private detenerTimer(): void {
    if (this.intervalo) {
      clearInterval(this.intervalo);
      this.intervalo = null;
    }
  }
}
