-- CSD App · M2 · Private storage buckets for field photos + signatures.
-- The app uploads to `{entrega_id}/{slot}.jpg`, then calls the RPC with the
-- paths. Buckets are private; access is authenticated-only.
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08d-storage-buckets.sql

insert into storage.buckets (id, name, public)
values ('vehiculos', 'vehiculos', false), ('conduces', 'conduces', false)
on conflict (id) do nothing;

-- Any authenticated field user may upload evidence and read it back. (Read is
-- further constrained at the record level by table RLS; the blobs themselves
-- are only reachable with a valid session + the exact path.)
drop policy if exists "csd_field_buckets_insert" on storage.objects;
create policy "csd_field_buckets_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('vehiculos', 'conduces'));

drop policy if exists "csd_field_buckets_select" on storage.objects;
create policy "csd_field_buckets_select" on storage.objects
  for select to authenticated
  using (bucket_id in ('vehiculos', 'conduces'));

-- Allow re-upload (upsert) of the same path on an offline re-send.
drop policy if exists "csd_field_buckets_update" on storage.objects;
create policy "csd_field_buckets_update" on storage.objects
  for update to authenticated
  using (bucket_id in ('vehiculos', 'conduces'))
  with check (bucket_id in ('vehiculos', 'conduces'));
