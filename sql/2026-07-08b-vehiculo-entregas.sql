-- CSD App · M2 · Vehicle responsibility checklist.
-- Append-only evidence: a `recepcion` opens custody, a `devolucion` closes it.
-- One responsible per vehicle at a time (enforced by a partial unique index,
-- not just the UI). Writes only via the SECURITY DEFINER RPC below; RLS gives
-- read access and blocks direct INSERT/UPDATE/DELETE (evidence immutability).
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08b-vehiculo-entregas.sql
-- Safe to run repeatedly.

-- ── Tables ──────────────────────────────────────────────────────────────
create table if not exists sgc.vehiculo_entregas (
  id                    uuid primary key,
  vehiculo_id           uuid not null references sgc.vehiculos(id),
  conductor_usuario_id  uuid not null references sgc.usuarios(id),
  tipo                  text not null check (tipo in ('recepcion','devolucion')),
  entrega_recepcion_id  uuid references sgc.vehiculo_entregas(id),
  estado                text not null default 'abierta' check (estado in ('abierta','cerrada')),
  km                    numeric(10,1) not null check (km >= 0),
  combustible           text not null check (combustible in ('E','1/4','1/2','3/4','F')),
  tiene_danos           boolean not null default false,
  observacion           text,
  firma_url             text not null,
  gps_lat               numeric,
  gps_lng               numeric,
  requiere_revision     boolean not null default false,
  capturado_en          timestamptz not null,
  created_at            timestamptz not null default now(),
  creado_por            uuid not null default auth.uid() references sgc.usuarios(id)
);

create table if not exists sgc.vehiculo_entrega_fotos (
  id            uuid primary key,
  entrega_id    uuid not null references sgc.vehiculo_entregas(id),
  slot          text not null check (slot in
                  ('frente','atras','lado_izq','lado_der','tablero','combustible','dano','entorno')),
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

create table if not exists sgc.vehiculo_entrega_danos (
  id            uuid primary key,
  entrega_id    uuid not null references sgc.vehiculo_entregas(id),
  zona          text not null check (zona in
                  ('frente','atras','lado_izq','lado_der','techo','interior','cristales','gomas')),
  descripcion   text,
  foto_path     text not null,
  es_nuevo      boolean not null default false
);

-- ── Indexes ─────────────────────────────────────────────────────────────
create index if not exists idx_ve_vehiculo on sgc.vehiculo_entregas (vehiculo_id, created_at desc);
create index if not exists idx_ve_conductor on sgc.vehiculo_entregas (conductor_usuario_id);
-- Only one OPEN reception per vehicle → one responsible at a time.
create unique index if not exists uq_ve_abierta
  on sgc.vehiculo_entregas (vehiculo_id)
  where tipo = 'recepcion' and estado = 'abierta';
create index if not exists idx_vef_entrega on sgc.vehiculo_entrega_fotos (entrega_id);
create index if not exists idx_ved_entrega on sgc.vehiculo_entrega_danos (entrega_id);

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table sgc.vehiculo_entregas enable row level security;
alter table sgc.vehiculo_entrega_fotos enable row level security;
alter table sgc.vehiculo_entrega_danos enable row level security;

-- Read: the driver sees their own custody rows; Flota staff see everything.
-- No INSERT/UPDATE/DELETE policies → only the SECURITY DEFINER RPC can write.
drop policy if exists "ve_select" on sgc.vehiculo_entregas;
create policy "ve_select" on sgc.vehiculo_entregas for select to authenticated
  using (conductor_usuario_id = auth.uid() or sgc.tiene_modulo('flota'));

drop policy if exists "vef_select" on sgc.vehiculo_entrega_fotos;
create policy "vef_select" on sgc.vehiculo_entrega_fotos for select to authenticated
  using (exists (
    select 1 from sgc.vehiculo_entregas e
    where e.id = entrega_id
      and (e.conductor_usuario_id = auth.uid() or sgc.tiene_modulo('flota'))
  ));

drop policy if exists "ved_select" on sgc.vehiculo_entrega_danos;
create policy "ved_select" on sgc.vehiculo_entrega_danos for select to authenticated
  using (exists (
    select 1 from sgc.vehiculo_entregas e
    where e.id = entrega_id
      and (e.conductor_usuario_id = auth.uid() or sgc.tiene_modulo('flota'))
  ));

-- ── Grants ──────────────────────────────────────────────────────────────
grant usage on schema sgc to authenticated;
grant select on sgc.vehiculo_entregas to authenticated;
grant select on sgc.vehiculo_entrega_fotos to authenticated;
grant select on sgc.vehiculo_entrega_danos to authenticated;

comment on table sgc.vehiculo_entregas is
  'CSD App: vehicle custody handoffs (append-only evidence). recepcion opens, devolucion closes.';
