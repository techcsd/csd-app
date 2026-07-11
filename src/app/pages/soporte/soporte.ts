import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { LocalStore } from '../../core/services/local-store.service';

/** Help / support: how the app works + how to get help (mirror of SGC Soporte). */
@Component({
  selector: 'app-soporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './soporte.html',
  styleUrl: './soporte.scss',
})
export class SoportePage {
  private router = inject(Router);
  private location = inject(Location);
  private store = inject(LocalStore);

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
