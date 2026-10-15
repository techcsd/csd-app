import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  Contrato,
  ContratoDetalle,
  ContratoEstado,
  ContratoTipo,
  ExpedienteArchivo,
  ExpedienteEstado,
  ExpedienteLegal,
  ExpedienteNota,
  ExpedientePrioridad,
  ExpedienteTipo,
} from '../models/legal.model';

const BUCKET = 'sgc-legal';

/**
 * CO13/CO11 — Legal (Expedientes + Contratos) en la app. **Sin RPC de listado,
 * detalle, creación ni cambio de estado del padre** (confirmado en `sql/`): todo es
 * acceso DIRECTO a tabla bajo la RLS `is_admin() or tiene_modulo('legal')` — misma
 * regla para expedientes, notas, archivos y contratos. Solo `contrato_detalle` y
 * `documento_usado_en_contrato` son RPC reales (CO13).
 */
@Injectable({ providedIn: 'root' })
export class LegalService {
  private supabase = inject(SupabaseService);

  /** Sin RPC ni trigger `default auth.uid()` en estas tablas (confirmado: insert
   *  directo) — hay que mandar el autor a mano o `creado_por`/`usuario_id`/`subido_por`
   *  quedan NULL (bug real encontrado en pruebas: las notas se guardaban sin autor). */
  private async miUid(): Promise<string | null> {
    const { data } = await this.supabase.client.auth.getUser();
    return data.user?.id ?? null;
  }

  // ── Expedientes ────────────────────────────────────────────────────────────

  async listarExpedientes(): Promise<ExpedienteLegal[]> {
    const { data, error } = await this.supabase.client
      .from('expedientes_legales')
      .select('*, proyecto:proyectos(nombre)')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Array<ExpedienteLegal & { proyecto: { nombre: string } | null }>).map((r) => ({
      ...r,
      proyecto_nombre: r.proyecto?.nombre ?? null,
    }));
  }

  async detalleExpediente(id: string): Promise<ExpedienteLegal | null> {
    const { data, error } = await this.supabase.client
      .from('expedientes_legales')
      .select('*, proyecto:proyectos(nombre)')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const r = data as ExpedienteLegal & { proyecto: { nombre: string } | null };
    return { ...r, proyecto_nombre: r.proyecto?.nombre ?? null };
  }

  async crearExpediente(input: {
    titulo: string;
    tipo: ExpedienteTipo;
    prioridad: ExpedientePrioridad;
    proyectoId: string | null;
    contraparte: string | null;
    descripcion: string | null;
  }): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('expedientes_legales')
      .insert({
        titulo: input.titulo,
        tipo: input.tipo,
        prioridad: input.prioridad,
        proyecto_id: input.proyectoId,
        contraparte: input.contraparte,
        descripcion: input.descripcion,
        creado_por: await this.miUid(),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async cambiarEstadoExpediente(id: string, estado: ExpedienteEstado): Promise<void> {
    const patch: Record<string, unknown> = { estado };
    if (estado === 'cerrado') patch['fecha_cierre'] = new Date().toISOString().slice(0, 10);
    const { error } = await this.supabase.client.from('expedientes_legales').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async fijarFechaLimite(id: string, fecha: string | null): Promise<void> {
    const { error } = await this.supabase.client
      .from('expedientes_legales')
      .update({ fecha_limite: fecha })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async notas(expedienteId: string): Promise<ExpedienteNota[]> {
    const { data, error } = await this.supabase.client
      .from('expediente_notas')
      .select('*')
      .eq('expediente_id', expedienteId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ExpedienteNota[];
    await this.resolverNombres(rows);
    return rows;
  }

  async agregarNota(expedienteId: string, nota: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('expediente_notas')
      .insert({ expediente_id: expedienteId, nota, usuario_id: await this.miUid() });
    if (error) throw new Error(error.message);
  }

  async archivos(expedienteId: string): Promise<ExpedienteArchivo[]> {
    const { data, error } = await this.supabase.client
      .from('expediente_archivos')
      .select('*')
      .eq('expediente_id', expedienteId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as ExpedienteArchivo[];
    await Promise.all(
      rows.map(async (r) => {
        r.url = await this.firmarArchivo(r.archivo_path);
      }),
    );
    return rows;
  }

  /** Sube un archivo/foto al expediente (online; Legal no entra al outbox, ver F6.4). */
  async subirArchivo(expedienteId: string, blob: Blob, nombre: string, mime: string): Promise<void> {
    const path = `${expedienteId}/${crypto.randomUUID()}-${nombre}`;
    const { error: upErr } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: mime, upsert: false });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client
      .from('expediente_archivos')
      .insert({ expediente_id: expedienteId, nombre, archivo_path: path, tipo_mime: mime, subido_por: await this.miUid() });
    if (error) throw new Error(error.message);
  }

  private async firmarArchivo(path: string): Promise<string | null> {
    try {
      const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  // ── Contratos ───────────────────────────────────────────────────────────────

  async listarContratos(): Promise<Contrato[]> {
    const { data, error } = await this.supabase.client
      .from('contratos')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Contrato[];
  }

  async contratoDetalle(id: string): Promise<ContratoDetalle | null> {
    const { data, error } = await this.supabase.client.rpc('contrato_detalle', { p_id: id });
    if (error || !data) return null;
    return data as ContratoDetalle;
  }

  /** CO13 — 3 caminos: `documentoGeneradoId` (ya generado), `archivoFirmadoPath`
   *  (PDF subido), o ninguno (se genera/firma después). */
  async crearContrato(input: {
    titulo: string;
    tipo: ContratoTipo;
    contraparteNombre: string;
    proyectoId: string | null;
    monto: number | null;
    fechaVencimiento: string | null;
    documentoGeneradoId?: string | null;
    archivoFirmadoPath?: string | null;
  }): Promise<string> {
    const estado: ContratoEstado = input.archivoFirmadoPath ? 'firmado' : 'borrador';
    const { data, error } = await this.supabase.client
      .from('contratos')
      .insert({
        titulo: input.titulo,
        tipo: input.tipo,
        contraparte_nombre: input.contraparteNombre,
        proyecto_id: input.proyectoId,
        monto: input.monto,
        fecha_vencimiento: input.fechaVencimiento,
        documento_generado_id: input.documentoGeneradoId ?? null,
        archivo_firmado_path: input.archivoFirmadoPath ?? null,
        estado,
        creado_por: await this.miUid(),
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async subirFirmado(id: string, blob: Blob, mime: string): Promise<void> {
    const path = `contratos-firmados/${id}/${crypto.randomUUID()}.pdf`;
    const { error: upErr } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: mime, upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { error } = await this.supabase.client
      .from('contratos')
      .update({ archivo_firmado_path: path, estado: 'firmado', fecha_firma: new Date().toISOString().slice(0, 10) })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async firmarUrlContrato(path: string): Promise<string | null> {
    try {
      const { data } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  async cambiarEstadoContrato(id: string, estado: ContratoEstado): Promise<void> {
    const { error } = await this.supabase.client.from('contratos').update({ estado }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  /** Nombres de usuario (RLS-safe; `usuarios` es admin-only). */
  private async resolverNombres(rows: Array<{ usuario_id: string | null; usuario_nombre?: string | null }>): Promise<void> {
    const ids = [...new Set(rows.map((r) => r.usuario_id).filter(Boolean))] as string[];
    if (!ids.length) return;
    try {
      const { data } = await this.supabase.client.rpc('usuarios_por_ids', { p_ids: ids });
      const map = new Map(((data as { id: string; nombre: string }[]) ?? []).map((u) => [u.id, u.nombre]));
      for (const r of rows) r.usuario_nombre = r.usuario_id ? (map.get(r.usuario_id) ?? null) : null;
    } catch {
      /* best-effort */
    }
  }
}
