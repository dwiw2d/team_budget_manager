-- 영수증 사진을 DB 에서 파일 저장소로 옮긴다 (설계 스펙 §4). 0001~0007 은 수정하지 않는다.
-- 옮기는 이유는 무료 요금제의 몫이 다르기 때문이다: Database 500MB 보다 File storage 1GB 가 크고,
-- 사진을 저장소로 빼면 500MB 를 결제 기록에만 쓸 수 있다(파일당 상한 50MB, 월 전송량 5GB).
-- 0006 배포 직후라 receipt_images 에 실제 사진이 없으므로 그냥 지운다.

-- 1. 표 제거 ---------------------------------------------------------------

drop table public.receipt_images;

-- 2. 버킷 receipts ---------------------------------------------------------
-- 비공개 버킷이다. 읽기는 아래 정책 + 짧은 서명 URL 로만 한다.
-- 파일당 1MB 상한은 우리 사진(긴 변 1200px·JPEG 0.7, 약 200KB)보다 넉넉하면서 사고를 막는 값이다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

-- 3. 저장소 접근 제어 -------------------------------------------------------
-- 경로 규칙은 {owner_id}/{payment_id}.jpg 다. 첫 폴더 이름이 곧 소유자이므로 그것으로 가린다.
-- select·insert·delete 만 연다. update 정책은 두지 않는다(사진은 고치지 않는다).
-- anon 정책은 없다.

create policy receipts_select on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy receipts_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy receipts_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- 4. 결제가 지워지면 사진 파일도 지운다 ---------------------------------------
-- 앱이 열려야만 정리되는 구조를 피하려고 DB 가 직접 지운다. SQL 로는 저장소 파일을 지울 수 없으므로
-- pg_net 으로 저장소 REST API 에 DELETE 를 보낸다. 비동기라 결제 삭제를 막지 않는다.
-- 한계: 실패해도 다시 시도하지 않는다. 그때는 파일만 남고 결제 기록은 이미 없다.

create extension if not exists pg_net with schema extensions;

-- 저장소 API 를 부르는 데 필요한 두 값은 Vault 에서 이름으로 읽는다. 파일에는 읽는 코드만 둔다.
-- 값을 넣는 것은 scripts/set-db-secrets.mjs(`npm run sb:db-secrets`) 가 한다.
-- 아직 넣지 않았으면 아무것도 하지 않고 끝낸다 — 비밀보다 결제 삭제가 먼저 동작해야 한다.
-- 사진이 없는 결제(직접 입력)도 요청을 보내지만 저장소가 404 를 돌려줄 뿐이라 그냥 둔다.

create function public.delete_receipt_object() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  project_url text;
  service_key text;
begin
  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'app_project_url';
  select decrypted_secret into service_key
    from vault.decrypted_secrets where name = 'app_service_role_key';
  if project_url is null or service_key is null then
    return null;
  end if;

  perform net.http_delete(
    url := rtrim(project_url, '/') || '/storage/v1/object/receipts/'
             || old.owner_id || '/' || old.id || '.jpg',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'apikey', service_key));
  return null;
end
$$;

revoke execute on function public.delete_receipt_object() from public, anon, authenticated;

create trigger payments_delete_receipt_object
  after delete on public.payments
  for each row execute function public.delete_receipt_object();
