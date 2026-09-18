-- 일시적 실패(HTTP 503 등 모델 과부하)에 무료 한도를 낭비하지 않는다.
-- 제공자를 부르기 직전의 선차감(0005 의 ocr_quota_consume)은 그대로 둔다. 응답이 유실돼도 과금분이
-- 세어지게 하려는 설계다. 다만 503 은 모델이 일을 하나도 하지 않은 것이라 한도를 쓴 적이 없다.
-- Edge Function 이 재시도와 모델 교체를 전부 소진하고도 503 으로만 끝나면 이 함수로 1건을 되돌린다.
-- 한도 초과(429)로 끝난 경우는 되돌리지 않는다. 그건 진짜로 쓴 것이다.

create function public.ocr_quota_refund(p_provider text) returns void
language plpgsql security definer set search_path = public as $$
declare
  p text := public.ocr_period(p_provider);
begin
  if p is null then
    return;
  end if;

  -- 0 아래로는 내려가지 않는다. 행이 없으면 깎을 것도 없으므로 아무 일도 하지 않는다.
  update ocr_usage
     set used = greatest(used - 1, 0)
   where provider = p_provider
     and period = p;
end
$$;

revoke execute on function public.ocr_quota_refund(text) from public, anon;
grant execute on function public.ocr_quota_refund(text) to authenticated;
