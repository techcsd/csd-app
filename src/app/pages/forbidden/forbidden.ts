import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

/** CW6/CW7 (D6) — texto fijo cuando el motivo es el rol chofer_privado restringido
 *  (sin conduces/rutas de empresa): explica el porqué en vez de un 403 genérico. */
@Component({
  selector: 'app-forbidden',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './forbidden.html',
  styleUrl: './forbidden.scss',
})
export class ForbiddenPage {
  private route = inject(ActivatedRoute);
  private params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  esChoferPrivado = computed(() => this.params().get('motivo') === 'chofer-privado');

  titulo = computed(() =>
    this.esChoferPrivado() ? 'Conduces y rutas no aplican a tu rol' : 'No tienes acceso',
  );

  texto = computed(() =>
    this.esChoferPrivado()
      ? 'Tu rol (chofer privado) no usa conduces ni rutas. Si debes hacerlo, pídelo a Central.'
      : 'Tu usuario no tiene permiso para esta sección. Si crees que es un error, habla con administración.',
  );
}
