-- Y15 (PROMPT-4) — El outbox de la app sube la foto de evidencia con upsert:true.
-- Un reintento re-sube el mismo path → UPDATE en storage.objects, que sin política
-- de UPDATE falla por RLS (403 → permanente). El bucket sgc-cronograma solo tenía
-- INSERT+SELECT (la web sube sin upsert, no lo necesita). Añadimos UPDATE para
-- que los reintentos offline del outbox funcionen. Aditivo/retrocompatible.
-- (Gotcha recurrente: buckets con upsert:true necesitan INSERT + UPDATE.)

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'sgc-cronograma: authenticated update'
  ) then
    create policy "sgc-cronograma: authenticated update"
      on storage.objects for update to authenticated
      using (bucket_id = 'sgc-cronograma')
      with check (bucket_id = 'sgc-cronograma');
  end if;
end $$;
