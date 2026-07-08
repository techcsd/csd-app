-- CSD App · Distribution · Public bucket for the signed APK + version.json.
-- The internal SGC download page and the app's update check read from here.
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08h-app-releases-bucket.sql

insert into storage.buckets (id, name, public)
values ('app-releases', 'app-releases', true)
on conflict (id) do update set public = true;

-- Public read (anyone with the link can download the APK / version.json).
drop policy if exists "app_releases_public_read" on storage.objects;
create policy "app_releases_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'app-releases');

-- Only the service_role (release script) writes here; no authenticated write.
