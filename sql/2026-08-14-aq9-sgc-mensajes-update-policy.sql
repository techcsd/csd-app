-- AQ9 — Adjuntos de chat (imágenes/archivos) suben por el outbox, que reintenta
-- con `upsert: true` y un path ESTABLE por mensaje (idempotencia). El bucket
-- sgc-mensajes solo tenía políticas de SELECT + INSERT, así que un re-envío tras
-- un fallo transitorio (mismo path → UPDATE) fallaba con "violates RLS".
-- Agrega la política de UPDATE con el MISMO alcance por participante
-- (carpeta [1] = conversación). Aditivo, idempotente, no afecta la web ni las
-- lecturas. Espeja el patrón de otros buckets con upsert (memoria del proyecto).
drop policy if exists "sgc-mensajes: scoped update" on storage.objects;
create policy "sgc-mensajes: scoped update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'sgc-mensajes'
    and sgc.es_participante(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'sgc-mensajes'
    and sgc.es_participante(((storage.foldername(name))[1])::uuid)
  );
