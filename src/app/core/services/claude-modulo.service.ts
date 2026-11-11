import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SupabaseService } from './supabase.service';
import { SyncService, throwSyncError } from '../sync/sync.service';
import {
  ClaudeEncuestaRespuesta,
  ClaudePack,
  ClaudeProgreso,
  ClaudeSkill,
} from '../models/claude-modulo.model';

/**
 * DM1 (ronda DM, PROMPT 140/141) — módulo Claude en la app: ver/descargar/
 * compartir skills, Setup (checklist + packs), crear skill sencilla y la
 * encuesta de auditoría. Administrar/aprobar/auditoría son web-only (DM-00).
 * Las escrituras que pueden ir sin red (encuesta, crear skill de texto) pasan
 * por el outbox — nunca directo.
 */
@Injectable({ providedIn: 'root' })
export class ClaudeModuloService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);

  constructor() {
    // DM-17 — la encuesta es texto puro: sin fotos, cabe entera en el payload.
    this.sync.register('claude_encuesta', async (payload) => {
      const { error } = await this.supabase.client.rpc('claude_encuesta_guardar', {
        p_usa_hoy: payload['usa_hoy'] ?? null,
        p_tareas: payload['tareas'] ?? null,
        p_tarea_repetida: payload['tarea_repetida'] ?? null,
        p_que_frena: payload['que_frena'] ?? null,
        p_documento_semanal: payload['documento_semanal'] ?? null,
        p_que_deberia_hacer: payload['que_deberia_hacer'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    // DM-09 — "crear skill sencilla": el SKILL.md ya viene generado (texto puro,
    // sin fotos) desde el formulario guiado; el handler solo lo sube cuando hay
    // red, vía la MISMA edge que valida/guarda en el servidor.
    this.sync.register('claude_skill_crear', async (payload) => {
      const form = new FormData();
      const contenido = String(payload['contenido_md'] ?? '');
      form.append('archivo', new Blob([contenido], { type: 'text/markdown' }), `${payload['slug']}.md`);
      form.append('slug', String(payload['slug'] ?? ''));
      form.append('nombre', String(payload['nombre'] ?? ''));
      form.append('descripcion', String(payload['descripcion'] ?? ''));
      const { data, error } = await this.supabase.client.functions.invoke('claude-skill-validar', { body: form });
      if (error) throwSyncError(error);
      const r = data as { ok?: boolean; errores?: string[] } | null;
      if (!r?.ok) throwSyncError({ message: r?.errores?.join(' ') || 'La skill no pasó la validación.', code: 'P0001' });
    });
  }

  // ── Skills (biblioteca) ──────────────────────────────────────────────────

  /** RLS ya filtra: lo mío + lo publicado para mi rol/empresa. */
  async listarSkills(): Promise<ClaudeSkill[]> {
    const { data, error } = await this.supabase.client
      .from('claude_skills')
      .select('id, slug, nombre, descripcion, tipo, ambito, estado, roles, tags, owner_id, version_actual, tiene_codigo_ejecutable, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ClaudeSkill[];
  }

  async listarPacks(): Promise<ClaudePack[]> {
    const { data, error } = await this.supabase.client
      .from('claude_packs')
      .select('id, slug, nombre, descripcion, tipo, rol');
    if (error) throw new Error(error.message);
    return (data ?? []) as ClaudePack[];
  }

  // ── Progreso del Setup (DM-13) ───────────────────────────────────────────

  async miProgreso(): Promise<ClaudeProgreso> {
    const { data, error } = await this.supabase.client
      .from('claude_progreso')
      .select('conecto_sgc, descargo_setup, subio_primera_skill, probo_pregunta')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      (data as ClaudeProgreso) ?? {
        conecto_sgc: false,
        descargo_setup: false,
        subio_primera_skill: false,
        probo_pregunta: false,
      }
    );
  }

  /** Online-only (confirmación puntual, como claude-conector): no hay nada que
   *  perder si se marca al reconectar — no amerita el outbox. */
  async marcarProgreso(campo: keyof ClaudeProgreso): Promise<void> {
    const { error } = await this.supabase.client.rpc('claude_progreso_marcar', { p_campo: campo, p_valor: true });
    if (error) throw new Error(error.message);
  }

  // ── Encuesta de auditoría (DM-17) ────────────────────────────────────────

  async miEncuesta(): Promise<ClaudeEncuestaRespuesta | null> {
    const { data, error } = await this.supabase.client
      .from('claude_encuesta_respuestas')
      .select('usa_hoy, tareas, tarea_repetida, que_frena, documento_semanal, que_deberia_hacer, updated_at')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ClaudeEncuestaRespuesta) ?? null;
  }

  /** Una respuesta por persona, editable — el mismo id de cliente reescribe. */
  async guardarEncuesta(r: ClaudeEncuestaRespuesta): Promise<void> {
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'claude_encuesta',
      payload: { ...r },
      resumen: 'Encuesta de Claude',
    });
  }

  // ── Crear skill sencilla (DM-09) ─────────────────────────────────────────

  async crearSkillTexto(slug: string, nombre: string, descripcion: string, contenidoMd: string): Promise<void> {
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'claude_skill_crear',
      payload: { slug, nombre, descripcion, contenido_md: contenidoMd },
      resumen: nombre,
    });
  }

  // ── Descargar + compartir (DM-08) ────────────────────────────────────────

  /** Pide el .zip (skill o pack) a la edge correspondiente. Solo-línea: el zip
   *  se arma en el servidor (LEEME-INSTALAR.md + escritor de zip propio). */
  private async descargarZip(fn: 'claude-skill-descargar' | 'claude-pack-zip', body: Record<string, string>): Promise<Blob> {
    const { data, error } = await this.supabase.client.functions.invoke(fn, { body });
    if (error) {
      const ctx = (error as { context?: unknown })?.context;
      let msg = error instanceof Error ? error.message : 'No se pudo generar el archivo.';
      if (ctx instanceof Response) {
        try {
          msg = (await ctx.clone().json())?.error ?? msg;
        } catch {
          /* body no-JSON */
        }
      }
      throw new Error(msg);
    }
    return data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/zip' });
  }

  async descargarSkillZip(skillId: string): Promise<Blob> {
    return this.descargarZip('claude-skill-descargar', { skill_id: skillId });
  }

  async descargarPackZip(packId: string): Promise<Blob> {
    return this.descargarZip('claude-pack-zip', { pack_id: packId });
  }

  /** Guarda el .zip en el teléfono (Documents/descargas del navegador). */
  async guardarZip(blob: Blob, filename: string): Promise<string> {
    if (Capacitor.isNativePlatform()) {
      const base64 = await this.blobToBase64(blob);
      await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents });
      return `Documentos/${filename}`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return filename;
  }

  /** DM-08 — "Compartir" (hoja nativa) hacia la app de Claude u otra. */
  async compartirZip(blob: Blob, filename: string, titulo: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      const base64 = await this.blobToBase64(blob);
      const w = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      await Share.share({ title: titulo, url: w.uri, dialogTitle: 'Compartir' });
      return;
    }
    const file = new File([blob], filename, { type: 'application/zip' });
    const navAny = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (navAny.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: titulo } as ShareData);
      return;
    }
    await this.guardarZip(blob, filename);
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => {
        const s = r.result as string;
        resolve(s.slice(s.indexOf('base64,') + 7));
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }
}
