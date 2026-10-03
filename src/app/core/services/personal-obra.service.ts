import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  Cargo,
  FirmaLinea,
  FirmaRol,
  FotoTipo,
  PersonalConteos,
  PersonalFirma,
  PersonalFoto,
  PersonalObra,
} from '../models/personal-obra.model';

const BUCKET = 'personal-obra';

/** Todas las fotos de evidencia que maneja el registro (slots del outbox). */
const FOTO_TIPOS: FotoTipo[] = ['persona', 'documento', 'pared', 'carnet', 'persona_carnet_cedula'];

/**
 * Regla 10 — columnas que `personal_editar` puede tocar en un UPDATE directo a
 * tabla. `cambios` viaja como objeto abierto por el outbox; si un día se colara
 * una clave que NO es columna (un campo de UI, un `as`), PostgREST rechazaría la
 * fila ENTERA (42703/PGRST204) y la op moriría permanente al sincronizar, lejos
 * del usuario. Filtrar contra esta lista degrada ese caso a "se ignora el campo
 * de más" en vez de "no se guarda nada". Mantener alineado con lo que edita el
 * expediente (personal-expediente.ts) + enqueueEstado.
 */
const EDITABLE_COLS = new Set<string>([
  'nombre',
  'apellido',
  'nacionalidad',
  'tipo_documento',
  'documento_numero',
  'cargo_id',
  'cuadrilla',
  'aseguramiento_estado',
  'telefono',
  'notas',
  'estado',
]);

const PERSONAL_SELECT = '*, cargo:cargos(id, codigo, nombre), proyecto:proyectos(nombre, codigo)';

/** AR1 (app) — datos capturados en el wizard para encolar el registro. */
export interface RegistroCaptura {
  /** Client UUID (idempotencia): también es el id de personal_obra. */
  id: string;
  proyectoId: string;
  nombre: string;
  apellido: string | null;
  nacionalidad: PersonalObra['nacionalidad'];
  tipoDocumento: PersonalObra['tipo_documento'];
  documentoNumero: string | null;
  cargoId: string | null;
  /** AV4 — cuadrilla (eje TECNICO) + aseguramiento manual. */
  cuadrilla: string | null;
  aseguramientoEstado: PersonalObra['aseguramiento_estado'];
  telefono: string | null;
  notas: string | null;
  /** Fotos por tipo (blob). Las ausentes se omiten. */
  fotos: Partial<Record<FotoTipo, Blob>>;
  /** ⏸ Firma del documento (paso PAUSA): PNG del pad + nombre del documento. */
  firma?: Blob | null;
  firmaDocumentoNombre?: string | null;
  // CF7 — snapshot del contrato generado con la plantilla por defecto.
  firmaPlantillaId?: string | null;
  firmaDocumentoHtml?: string | null;
  firmaValores?: Record<string, string> | null;
}

/**
 * AR1 — Registro de Personal de obra (app). Registro EN OBRA por hojas
 * (offline-first): el wizard encola UNA op de outbox con las 5 fotos + datos;
 * el handler inserta el personal (client UUID = idempotencia), sube las fotos,
 * registra la firma (si viene) y **emite el carnet** (número CSD-###### server).
 * Lecturas cache-then-network (la RLS acota por obra: elevados todo, ingeniero/
 * capataz su obra). Reúsa el mismo contrato/entidad que SGC (carnet/QR/expediente).
 */
@Injectable({ providedIn: 'root' })
export class PersonalObraService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  private get client() {
    return this.supabase.client;
  }

  constructor() {
    this.registerHandlers();
  }

  // ── Catálogo de cargos (referencia, cache — funciona offline) ───────────────
  async getCargos(): Promise<Cargo[]> {
    const data = await this.catalog.refresh<Cargo[]>('personal_cargos', async () => {
      const { data, error } = await this.client.from('cargos').select('*').eq('activo', true).order('orden');
      if (error) throw new Error(error.message);
      return (data ?? []) as Cargo[];
    });
    return data ?? [];
  }

  // ── Obras visibles (directorio SECURITY DEFINER, desacoplado del módulo AN3) ─
  async getObras(): Promise<{ id: string; nombre: string }[]> {
    const data = await this.catalog.refresh<{ id: string; nombre: string }[]>('personal_obras', async () => {
      const { data, error } = await this.client.rpc('directorio_proyectos');
      if (error) throw new Error(error.message);
      return ((data as { id: string; nombre: string }[]) ?? []).map((p) => ({ id: p.id, nombre: p.nombre }));
    });
    return data ?? [];
  }

  // ── Listado del personal (RLS por obra) — cache-then-network ────────────────
  /**
   * CE2 — usa el RPC definer `listar_personal_obra()` que resuelve
   * `registrado_por_nombre` para CUALQUIER rol (antes el embed a `usuarios` bajo
   * RLS volvía null y la columna "Registró" salía "—" para Sonia/Legal). Detrás de
   * COMPROBACIÓN DE CAPACIDAD: si el padre aún no expone el RPC, cae al select
   * directo (sin el nombre de quien registró, pero la lista funciona).
   */
  async listar(): Promise<PersonalObra[]> {
    const data = await this.catalog.refresh<PersonalObra[]>('personal_lista', async () => {
      const { data, error } = await this.client.rpc('listar_personal_obra', { p_proyecto: null });
      if (!error) return ((data as unknown as PersonalObra[]) ?? []);
      // Fallback: RPC ausente → select directo (sin registrado_por_nombre).
      const r = await this.client
        .from('personal_obra')
        .select(PERSONAL_SELECT)
        .order('created_at', { ascending: false });
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as unknown as PersonalObra[];
    });
    return data ?? [];
  }

  async getById(id: string): Promise<PersonalObra | null> {
    const { data, error } = await this.client.from('personal_obra').select(PERSONAL_SELECT).eq('id', id).maybeSingle();
    if (error || !data) {
      const cached = (await this.catalog.read<PersonalObra[]>('personal_lista')) ?? [];
      return cached.find((p) => p.id === id) ?? null;
    }
    const row = data as unknown as PersonalObra;
    // CE2 — el select directo no trae registrado_por_nombre (embed a usuarios bajo
    // RLS); lo tomamos del cache de la lista (que viene del RPC definer).
    if (row.registrado_por_nombre == null) {
      const cached = (await this.catalog.read<PersonalObra[]>('personal_lista')) ?? [];
      const hit = cached.find((p) => p.id === id);
      if (hit?.registrado_por_nombre) row.registrado_por_nombre = hit.registrado_por_nombre;
    }
    return row;
  }

  async getFotos(personalId: string): Promise<PersonalFoto[]> {
    const { data, error } = await this.client.from('personal_obra_fotos').select('*').eq('personal_id', personalId);
    if (error) return [];
    return (data ?? []) as PersonalFoto[];
  }

  async getFirmas(personalId: string): Promise<PersonalFirma[]> {
    const { data, error } = await this.client
      .from('personal_obra_firmas')
      .select('*')
      .eq('personal_id', personalId)
      .order('firmado_at', { ascending: false });
    if (error) return [];
    return (data ?? []) as PersonalFirma[];
  }

  // ── CF1 — líneas de firma por rol (empleador / testigos). Online (legal firma con red). ──
  async lineasFirma(firmaId: string): Promise<FirmaLinea[]> {
    const { data, error } = await this.client.rpc('lineas_firma_documento', { p_firma_id: firmaId });
    if (error) return [];
    return (data ?? []) as FirmaLinea[];
  }

  /** Registra la firma de una línea (empleador/testigo): pad/foto = digital, fisico = en papel. */
  async firmarLinea(
    firma: PersonalFirma,
    personal: PersonalObra,
    rol: FirmaRol,
    metodo: 'pad' | 'foto' | 'fisico',
    opts: { firma?: Blob | null; nombre?: string | null; cedula?: string | null } = {},
  ): Promise<void> {
    let path: string | null = null;
    if (opts.firma) {
      const ext = metodo === 'fisico' ? (opts.firma.type.includes('pdf') ? 'pdf' : 'jpg') : 'png';
      path = `${personal.proyecto_id}/${personal.id}/firma-${rol}-${Date.now()}.${ext}`;
      const { error: upErr } = await this.client.storage
        .from(BUCKET)
        .upload(path, opts.firma, { upsert: true, contentType: opts.firma.type || 'image/png' });
      if (upErr) throw new Error(upErr.message);
    }
    const { error } = await this.client.rpc('firmar_linea_documento', {
      p_firma_id: firma.id,
      p_rol: rol,
      p_metodo: metodo,
      p_firma_path: path,
      p_firmante_nombre: opts.nombre ?? null,
      p_firmante_cedula: opts.cedula ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** CF7 — sube el escaneo/foto de un documento firmado en papel al expediente. */
  async subirDocumentoFirmado(personal: PersonalObra, documentoNombre: string, archivo: Blob, ext: string): Promise<void> {
    const path = `${personal.proyecto_id}/${personal.id}/doc-firmado-${Date.now()}.${ext}`;
    const { error: upErr } = await this.client.storage
      .from(BUCKET)
      .upload(path, archivo, { upsert: true, contentType: archivo.type || 'application/octet-stream' });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.client.from('personal_obra_firmas').insert({
      personal_id: personal.id,
      documento_nombre: documentoNombre,
      firma_path: path,
      documento_path: path,
      metodo: 'foto',
    });
    if (error) throw new Error(error.message);
  }

  /**
   * CE16 — ¿ya existe un trabajador ACTIVO con este documento? (aviso suave al
   * registrar; nunca bloquea). Usa el RPC definer `personal_obra_doc_existe`, que
   * normaliza el documento (dígitos para cédula, alfanum para pasaporte). Detrás de
   * COMPROBACIÓN DE CAPACIDAD + best-effort (nunca corre offline): cualquier fallo
   * devuelve [] (no molestar).
   */
  async docExiste(
    tipo: string,
    numero: string,
    excluirId?: string | null,
  ): Promise<{ id: string; nombre: string; proyecto: string | null }[]> {
    if (!numero?.trim()) return [];
    try {
      const { data, error } = await this.client.rpc('personal_obra_doc_existe', {
        p_tipo: tipo,
        p_numero: numero,
        p_exclude: excluirId ?? null,
      });
      if (error) return [];
      return (data as { id: string; nombre: string; proyecto: string | null }[]) ?? [];
    } catch {
      return [];
    }
  }

  /** Conteos por obra (total, por cargo, por nacionalidad) — espejo de la web. */
  async conteos(proyectoId: string): Promise<PersonalConteos | null> {
    const { data, error } = await this.client.rpc('personal_obra_conteos', { p_proyecto_id: proyectoId });
    if (error) return null;
    if (!data || Object.keys(data).length === 0) return null;
    return data as PersonalConteos;
  }

  /**
   * CE5 — registra una reimpresión del carnet (auditoría, espejo de la web). Best-effort
   * + detrás de capacidad: si el padre no expone el RPC, no bloquea el compartir.
   */
  async registrarReimpresion(personalId: string): Promise<void> {
    try {
      await this.client.rpc('registrar_reimpresion_carnet', { p_id: personalId });
    } catch {
      /* best-effort: la reimpresión no se audita, pero el carnet se comparte igual */
    }
  }

  /** URL firmada de una foto del bucket privado (thumbnail opcional). */
  async fotoUrl(path: string, thumb = false): Promise<string | null> {
    const { data } = await this.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600, thumb ? { transform: { width: 400, quality: 70 } } : undefined);
    return data?.signedUrl ?? null;
  }

  // ── Registro (offline-first, por outbox) ────────────────────────────────────
  /** Encola el registro completo (datos + fotos + firma) como UNA op idempotente. */
  async enqueueRegistro(input: RegistroCaptura): Promise<void> {
    const id = input.id;
    const capturado_en = new Date().toISOString();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    for (const tipo of FOTO_TIPOS) {
      const blob = input.fotos[tipo];
      if (blob) {
        fotos.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `${input.proyectoId}/${id}/${tipo}.jpg`, slot: tipo, blob });
      }
    }
    if (input.firma) {
      fotos.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `${input.proyectoId}/${id}/firma.png`, slot: 'firma', blob: input.firma });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'personal_registro',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        nombre: input.nombre,
        apellido: input.apellido,
        nacionalidad: input.nacionalidad,
        tipo_documento: input.tipoDocumento,
        documento_numero: input.documentoNumero,
        cargo_id: input.cargoId,
        cuadrilla: input.cuadrilla, // AV4
        aseguramiento_estado: input.aseguramientoEstado ?? 'desconocido', // AV4
        telefono: input.telefono,
        notas: input.notas,
        registrado_por: this.ctx.profile()?.id ?? null,
        firma_documento_nombre: input.firmaDocumentoNombre ?? null,
        // CF7 — snapshot del contrato (plantilla por defecto renderizada).
        firma_plantilla_id: input.firmaPlantillaId ?? null,
        firma_documento_html: input.firmaDocumentoHtml ?? null,
        firma_valores: input.firmaValores ?? null,
      },
      fotos,
      resumen: { tipo: 'personal_registro', nombre: `${input.nombre} ${input.apellido ?? ''}`.trim(), capturado_en },
    });
    // No se invalida el cache aquí: offline dejaría la lista vacía (no hay red para
    // recargarla). El handler invalida `personal_lista` tras sincronizar con éxito.
  }

  /** Edita datos (offline-safe). `cambios` = columnas a actualizar. */
  async enqueueEditar(id: string, cambios: Partial<PersonalObra>): Promise<void> {
    const opId = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id: opId,
      tipo_op: 'personal_editar',
      capturado_en,
      payload: { id, cambios: cambios as Record<string, unknown> },
      fotos: [],
      resumen: { tipo: 'personal_editar', personal_id: id, capturado_en },
    });
    // El handler invalida `personal_lista` al sincronizar (no aquí: offline dejaría
    // la lista en blanco). El expediente ya refleja el cambio de forma optimista.
  }

  /** Activa/desactiva al personal (soft, por outbox). */
  async enqueueEstado(id: string, estado: PersonalObra['estado']): Promise<void> {
    await this.enqueueEditar(id, { estado });
  }

  /**
   * CE4 — añadir (o reemplazar) UNA foto de evidencia de un registro ya creado,
   * desde el expediente. Offline-first por outbox: sube la foto al bucket y hace
   * upsert de la fila `personal_obra_fotos` (idempotente por personal_id+tipo).
   */
  async enqueueAgregarFoto(
    personalId: string,
    proyectoId: string,
    tipo: FotoTipo,
    blob: Blob,
  ): Promise<void> {
    const opId = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id: opId,
      tipo_op: 'personal_foto',
      capturado_en,
      payload: { personal_id: personalId, tipo, capturado_en },
      fotos: [
        { id: crypto.randomUUID(), bucket: BUCKET, path: `${proyectoId}/${personalId}/${tipo}.jpg`, slot: tipo, blob },
      ],
      resumen: { tipo: 'personal_foto', personal_id: personalId, foto: tipo, capturado_en },
    });
  }

  private registerHandlers(): void {
    // Registro completo: personal + fotos + firma (⏸) + carnet.
    this.sync.register('personal_registro', async (payload, photoPaths) => {
      const id = payload['id'] as string;
      // 1) Personal (upsert por id → idempotente ante reintentos). La RLS valida
      //    el permiso (puede_gestionar_personal_obra) y el trigger fija es_prueba.
      const { error: upErr } = await this.client.from('personal_obra').upsert(
        {
          id,
          proyecto_id: payload['proyecto_id'],
          nombre: payload['nombre'],
          apellido: payload['apellido'] ?? null,
          nacionalidad: payload['nacionalidad'] ?? 'dominicano',
          tipo_documento: payload['tipo_documento'] ?? 'cedula',
          documento_numero: payload['documento_numero'] ?? null,
          cargo_id: payload['cargo_id'] ?? null,
          cuadrilla: payload['cuadrilla'] ?? null, // AV4
          aseguramiento_estado: payload['aseguramiento_estado'] ?? 'desconocido', // AV4
          telefono: payload['telefono'] ?? null,
          notas: payload['notas'] ?? null,
          registrado_por: payload['registrado_por'] ?? null,
        },
        { onConflict: 'id' },
      );
      if (upErr) throwSyncError(upErr);

      // 2) Fotos tipadas (upsert una por tipo → idempotente).
      const fotoRows = FOTO_TIPOS.filter((t) => photoPaths[t]).map((t) => ({
        personal_id: id,
        tipo: t,
        foto_path: photoPaths[t],
      }));
      if (fotoRows.length) {
        const { error } = await this.client.from('personal_obra_fotos').upsert(fotoRows, { onConflict: 'personal_id,tipo' });
        if (error) throwSyncError(error);
      }

      // 3) ⏸ Firma del documento (paso en PAUSA): solo si el wizard la produjo. Se
      //    inserta una sola vez (evita duplicar al reintentar la op).
      if (photoPaths['firma']) {
        const { count } = await this.client
          .from('personal_obra_firmas')
          .select('id', { count: 'exact', head: true })
          .eq('personal_id', id);
        if (!count) {
          const { data: ins, error } = await this.client.from('personal_obra_firmas').insert({
            personal_id: id,
            documento_nombre: (payload['firma_documento_nombre'] as string) ?? 'Documento firmado',
            firma_path: photoPaths['firma'],
            metodo: 'pad',
            // CF7 — snapshot del contrato generado con la plantilla (si la hubo).
            plantilla_id: (payload['firma_plantilla_id'] as string) ?? null,
            documento_html: (payload['firma_documento_html'] as string) ?? null,
            valores: (payload['firma_valores'] as Record<string, unknown>) ?? null,
          }).select('id').single();
          if (error) throwSyncError(error);
          // CF1 — siembra las líneas de firma (empleador + 2 testigos) para que Legal las
          // complete después desde el expediente (ahora / en papel / después).
          if (ins?.id) {
            await this.client.rpc('sembrar_lineas_firma', {
              p_firma_id: ins.id,
              p_roles: ['empleador', 'testigo_1', 'testigo_2'],
            }).then(() => {}, () => {}); // best-effort: no tumbar el registro si falla
          }
        }
      }

      // 4) Emite el carnet (número CSD-###### server-side; idempotente).
      const { error: cErr } = await this.client.rpc('emitir_carnet_personal', { p_id: id });
      if (cErr) throwSyncError(cErr);

      this.catalog.invalidate('personal_lista');
    });

    // Edición de datos / cambio de estado.
    this.sync.register('personal_editar', async (payload) => {
      const crudo = (payload['cambios'] as Record<string, unknown>) ?? {};
      // Regla 10 — solo columnas reales llegan al UPDATE directo; una clave
      // fantasma se descarta aquí en vez de tumbar la fila entera al sincronizar.
      const cambios: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(crudo)) {
        if (EDITABLE_COLS.has(k)) cambios[k] = v;
      }
      if (!Object.keys(cambios).length) {
        this.catalog.invalidate('personal_lista');
        return;
      }
      const { error } = await this.client.from('personal_obra').update(cambios).eq('id', payload['id']);
      if (error) throwSyncError(error);
      this.catalog.invalidate('personal_lista');
    });

    // CE4 — añadir/reemplazar una foto de evidencia de un registro existente.
    this.sync.register('personal_foto', async (payload, photoPaths) => {
      const tipo = payload['tipo'] as string;
      const path = photoPaths[tipo];
      if (!path) return; // sin foto subida: nada que hacer (no es error)
      const { error } = await this.client
        .from('personal_obra_fotos')
        .upsert({ personal_id: payload['personal_id'], tipo, foto_path: path }, { onConflict: 'personal_id,tipo' });
      if (error) throwSyncError(error);
      this.catalog.invalidate('personal_lista');
    });
  }
}
