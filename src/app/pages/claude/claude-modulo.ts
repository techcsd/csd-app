import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { NavGuardService } from '../../core/services/nav-guard.service';
import { ToastService } from '../../core/services/toast.service';
import { NetworkService } from '../../core/services/network.service';
import { UserContextService } from '../../core/services/user-context.service';
import { ClaudeModuloService } from '../../core/services/claude-modulo.service';
import { ClaudeEncuestaRespuesta, ClaudePack, ClaudeProgreso, ClaudeSkill, ClaudeSkillBorrador } from '../../core/models/claude-modulo.model';
import { generarSkillMd, generarSlug } from '../../core/util/claude-skill-md';

type Tab = 'inicio' | 'skills' | 'crear' | 'encuesta';

/**
 * DM1-DM4/DM-08/DM-09/DM-11/DM-13/DM-17 (ronda DM, PROMPT 141 F1/F2) — Módulo
 * Claude en la app: Setup (checklist), biblioteca de skills por rol (ver/
 * descargar/compartir), crear skill sencilla y la encuesta corta de auditoría.
 * Administrar/aprobar/auditoría son web-only (DM-00). Sin gate de módulo (como
 * Notas/Configuración): todo usuario autenticado.
 */
@Component({
  selector: 'app-claude-modulo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, TranslatePipe],
  templateUrl: './claude-modulo.html',
})
export class ClaudeModuloPage {
  private claude = inject(ClaudeModuloService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  network = inject(NetworkService);

  tab = signal<Tab>('inicio');
  loading = signal(true);

  progreso = signal<ClaudeProgreso | null>(null);
  skills = signal<ClaudeSkill[]>([]);
  packs = signal<ClaudePack[]>([]);
  encuesta = signal<ClaudeEncuestaRespuesta | null>(null);

  private misRoles = this.ctx.roles;

  /** DM-11 — "Recomendadas para tu rol" arriba, el resto debajo; la unión de roles
   *  si la persona tiene varios (sin curar nada persona por persona). */
  skillsRecomendadas = computed(() => {
    const roles = new Set(this.misRoles());
    return this.skills().filter((s) => s.estado === 'publicada' && s.ambito === 'rol' && s.roles.some((r) => roles.has(r)));
  });
  skillsEmpresa = computed(() => this.skills().filter((s) => s.estado === 'publicada' && s.ambito === 'empresa'));
  misSkills = computed(() => this.skills().filter((s) => s.estado !== 'publicada'));

  pasosCompletos = computed(() => {
    const p = this.progreso();
    if (!p) return 0;
    return [p.conecto_sgc, p.descargo_setup, p.subio_primera_skill, p.probo_pregunta].filter(Boolean).length;
  });

  // ── Crear (DM-09) ─────────────────────────────────────────────────────────
  borrador: ClaudeSkillBorrador = { titulo: '', queHace: '', cuandoUsarla: '', pasos: '', ejemplo: '' };
  guardandoSkill = signal(false);
  vistaPreviaMd = computed(() => (this.borrador.titulo.trim() ? generarSkillMd(generarSlug(this.borrador.titulo), this.borrador) : ''));

  // ── Encuesta (DM-17) ─────────────────────────────────────────────────────
  encuestaForm: ClaudeEncuestaRespuesta = {
    usa_hoy: '',
    tareas: '',
    tarea_repetida: '',
    que_frena: '',
    documento_semanal: '',
    que_deberia_hacer: '',
  };
  guardandoEncuesta = signal(false);

  descargandoId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  setTab(t: Tab): void {
    this.tab.set(t);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [progreso, skills, packs, encuesta] = await Promise.all([
        this.claude.miProgreso(),
        this.claude.listarSkills().catch(() => []),
        this.claude.listarPacks().catch(() => []),
        this.claude.miEncuesta().catch(() => null),
      ]);
      this.progreso.set(progreso);
      this.skills.set(skills);
      this.packs.set(packs);
      this.encuesta.set(encuesta);
      if (encuesta) this.encuestaForm = { ...encuesta };
    } finally {
      this.loading.set(false);
    }
  }

  // ── Setup (DM-13) ─────────────────────────────────────────────────────────
  async marcar(campo: keyof ClaudeProgreso): Promise<void> {
    const anterior = this.progreso();
    this.progreso.update((p) => (p ? { ...p, [campo]: true } : p));
    try {
      await this.claude.marcarProgreso(campo);
    } catch {
      this.progreso.set(anterior); // best-effort: revierte si falló
    }
  }

  irAMiConexion(): void {
    void this.router.navigate(['/perfil/claude']);
  }

  // ── Skills: descargar/compartir (DM-08) ──────────────────────────────────
  async descargar(s: ClaudeSkill): Promise<void> {
    if (!this.network.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para descargar.'));
      return;
    }
    this.descargandoId.set(s.id);
    try {
      const blob = await this.claude.descargarSkillZip(s.id);
      const dest = await this.claude.guardarZip(blob, `${s.slug}.zip`);
      void this.claude.marcarProgreso('descargo_setup');
      this.toast.success(this.i18n.t('Guardado: {dest}', { dest }));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo descargar.'));
    } finally {
      this.descargandoId.set(null);
    }
  }

  async compartir(s: ClaudeSkill): Promise<void> {
    if (!this.network.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para compartir.'));
      return;
    }
    this.descargandoId.set(s.id);
    try {
      const blob = await this.claude.descargarSkillZip(s.id);
      await this.claude.compartirZip(blob, `${s.slug}.zip`, s.nombre);
      void this.claude.marcarProgreso('descargo_setup');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo compartir.'));
    } finally {
      this.descargandoId.set(null);
    }
  }

  async descargarPack(p: ClaudePack): Promise<void> {
    if (!this.network.online()) {
      this.toast.error(this.i18n.t('Necesitas conexión para descargar.'));
      return;
    }
    this.descargandoId.set(p.id);
    try {
      const blob = await this.claude.descargarPackZip(p.id);
      const dest = await this.claude.guardarZip(blob, `${p.slug}.zip`);
      void this.claude.marcarProgreso('descargo_setup');
      this.toast.success(this.i18n.t('Guardado: {dest}', { dest }));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo descargar el paquete.'));
    } finally {
      this.descargandoId.set(null);
    }
  }

  // ── Crear (DM-09) ─────────────────────────────────────────────────────────
  crearValido(): boolean {
    return !!(this.borrador.titulo.trim() && this.borrador.queHace.trim() && this.borrador.cuandoUsarla.trim());
  }

  async guardarSkill(): Promise<void> {
    if (!this.crearValido() || this.guardandoSkill()) return;
    this.guardandoSkill.set(true);
    try {
      const slug = generarSlug(this.borrador.titulo);
      const md = generarSkillMd(slug, this.borrador);
      await this.claude.crearSkillTexto(slug, this.borrador.titulo.trim(), this.borrador.queHace.trim(), md);
      void this.claude.marcarProgreso('subio_primera_skill');
      this.toast.success(
        this.network.online()
          ? this.i18n.t('Skill creada. Ya puedes descargarla en Skills.')
          : this.i18n.t('Se creará al reconectar. La verás en Skills.'),
      );
      this.borrador = { titulo: '', queHace: '', cuandoUsarla: '', pasos: '', ejemplo: '' };
      this.tab.set('skills');
      void this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo crear la skill.'));
    } finally {
      this.guardandoSkill.set(false);
    }
  }

  // ── Encuesta (DM-17) ─────────────────────────────────────────────────────
  async guardarEncuesta(): Promise<void> {
    if (this.guardandoEncuesta()) return;
    this.guardandoEncuesta.set(true);
    try {
      await this.claude.guardarEncuesta(this.encuestaForm);
      this.encuesta.set({ ...this.encuestaForm });
      this.toast.success(
        this.network.online()
          ? this.i18n.t('¡Gracias! Tu respuesta quedó guardada.')
          : this.i18n.t('Se guardará al reconectar.'),
      );
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : this.i18n.t('No se pudo guardar la encuesta.'));
    } finally {
      this.guardandoEncuesta.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/perfil');
  }
}
