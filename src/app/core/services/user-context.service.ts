import { computed, inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Usuario } from '../models/usuario.model';

/**
 * Holds the signed-in user's profile, roles and module gates — the same
 * shape SGC's UserService uses, so Home gating matches the web exactly.
 * Obra activa / vehículo a cargo are enriched from v_app_mi_contexto once
 * available; until then those signals are null and the app still works.
 */
@Injectable({ providedIn: 'root' })
export class UserContextService {
  private supabase = inject(SupabaseService);

  private _profile = signal<Usuario | null>(null);
  profile = this._profile.asReadonly();

  private _obraActiva = signal<{ id: string; nombre: string } | null>(null);
  obraActiva = this._obraActiva.asReadonly();

  /** Distinct module keys across all of the user's roles. */
  modulos = computed(() => {
    const all = this._profile()?.roles?.flatMap((ur) => ur.rol.modulos) ?? [];
    return [...new Set(all)];
  });

  roles = computed(() => this._profile()?.roles?.map((ur) => ur.rol.codigo) ?? []);

  nombre = computed(() => this._profile()?.nombre ?? '');

  hasModulo(modulo: string): boolean {
    return this.modulos().includes(modulo);
  }

  async loadProfile(userId: string): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('usuarios')
      .select('id, nombre, email, activo, avatar_path, roles:usuarios_roles!usuario_id(rol:roles(codigo, nombre, modulos))')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('UserContextService.loadProfile:', error.message);
      this._profile.set(null);
      return;
    }
    this._profile.set(data as unknown as Usuario);
  }

  setObraActiva(obra: { id: string; nombre: string } | null): void {
    this._obraActiva.set(obra);
  }

  clear(): void {
    this._profile.set(null);
    this._obraActiva.set(null);
  }
}
