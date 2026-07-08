import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';

export type ReporteTipo = 'bug' | 'sugerencia' | 'comentario';

/**
 * Field feedback → SGC's reportes_usuario (Deployment §6). Lands in
 * Administración → Comentarios y Reportes so admin sees app issues.
 */
@Injectable({ providedIn: 'root' })
export class ReportesService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);

  async crear(tipo: ReporteTipo, asunto: string, descripcion: string): Promise<void> {
    const usuario_id = this.ctx.profile()?.id;
    if (!usuario_id) throw new Error('Sesión inválida.');
    const { error } = await this.supabase.client
      .from('reportes_usuario')
      .insert({ usuario_id, tipo, asunto: asunto.trim(), descripcion: descripcion.trim() });
    if (error) throw new Error(error.message);
  }
}
