-- 영수증 사진 보관 (설계 스펙 §4). 0001~0005 는 이미 클라우드에 적용됐으므로 수정하지 않는다.
-- 사진은 파일 저장소가 아니라 데이터베이스에 담는다: 자체 서버 이전과 백업이 단순해지고,
-- 결제가 지워지면 아래 on delete cascade 로 사진도 함께 사라진다.
-- 결제 표에 합치지 않고 별도 표로 둔다. 목록 조회가 무거워지지 않게 하려는 것이다(상세 시트에서만 읽는다).

-- 1. 테이블 ---------------------------------------------------------------
-- 결제 하나에 사진 하나이므로 payment_id 가 그대로 기본 키다.
-- 길이 상한 60만 자는 base64 기준 약 450KB 다. 앱이 목표하는 장당 200KB 보다 넉넉해 품질 편차를 흡수한다.

create table public.receipt_images (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id),
  data_url text not null check (data_url like 'data:image/%' and length(data_url) between 100 and 600000),
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

-- 2. 행 단위 접근 제어 (RLS) ----------------------------------------------
-- authenticated 만 owner_id = auth.uid() 조건으로 select·insert. anon 정책은 없다.
-- update·delete 정책은 두지 않는다. 사진은 고치지 않고, 삭제는 결제가 지워질 때 cascade 로만 일어난다.

alter table public.receipt_images enable row level security;

create policy receipt_images_select on public.receipt_images
  for select to authenticated using (owner_id = auth.uid());
create policy receipt_images_insert on public.receipt_images
  for insert to authenticated with check (owner_id = auth.uid());
