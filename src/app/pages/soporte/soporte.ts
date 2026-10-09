import { AfterViewInit, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { LocalStore } from '../../core/services/local-store.service';

/** Help / support: how the app works + how to get help (mirror of SGC Soporte). */
@Component({
  selector: 'app-soporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './soporte.html',
  styleUrl: './soporte.scss',
})
export class SoportePage implements AfterViewInit {
  private router = inject(Router);
  private location = inject(Location);
  private store = inject(LocalStore);
  private route = inject(ActivatedRoute);

  readonly faqs = [
    {
      q: '¿Puedo usar la app sin señal?',
      a: 'Sí. Todo lo que registres se guarda en el teléfono y se envía solo cuando vuelve la señal. La barra de abajo te dice si hay algo pendiente.',
    },
    {
      q: '¿Por qué me pide un PIN?',
      a: 'Para entrar rápido sin escribir tu contraseña. Si lo olvidas 5 veces, entras con tu contraseña del sistema.',
    },
    {
      q: '¿Dónde veo lo que envié?',
      a: 'En cada sección hay una lista de lo tuyo: "Mis bitácoras", "Mis solicitudes", etc.',
    },
    {
      q: '¿Encontraste un problema?',
      a: 'Usa "Reportar un problema" para avisarle a administración.',
    },
  ];

  /** CK10 — si se llega con ?seccion=notificaciones, baja hasta la guía de avisos. */
  ngAfterViewInit(): void {
    if (this.route.snapshot.queryParamMap.get('seccion') !== 'notificaciones') return;
    // El reset de scroll del shell corre tras montar la vista (doble rAF); este timeout
    // gana la carrera y deja la guía visible.
    setTimeout(() => {
      document.getElementById('guia-notificaciones')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }

  reportar(): void {
    void this.router.navigate(['/reportar']);
  }
  verTutorial(): void {
    void this.store.remove('csd_onboarding_v1_done').then(() => {
      void this.router.navigate(['/home']);
    });
  }
  back(): void {
    this.location.back();
  }
}
