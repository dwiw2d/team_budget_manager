/** 시작 관문(`src/StartupGate.tsx`)의 순수 판단. 브라우저를 읽는 쪽과 나눠 두어 따로 시험한다. */

/** 파일 선택기를 여는 순간 남기는 표시. 사진을 고르고 돌아올 때 관문이 화면을 새로 받지 않게 한다. */
export const PHOTO_PICKER_KEY = "sw2hw:picking-photo";
/** 업데이트를 적용한 시각(ms). 새로 로드한 직후 검사를 건너뛰어 되풀이를 막는다. */
export const JUST_UPDATED_KEY = "sw2hw:just-updated-at";

/**
 * 업데이트를 적용하고 이만큼 안에 관문이 다시 돌면 검사를 건너뛴다. 정상이라면 새로 로드한 뒤에는
 * 최신이라 그냥 통과하므로 이 가드는 배포가 깨진 비정상 상황에서만 쓰이는 최후 방어선이다.
 */
export const JUST_UPDATED_WINDOW_MS = 10_000;

/** 이번 실행에서 관문을 건너뛸 이유가 있는가. */
export function shouldSkipGate(s: {
  online: boolean;
  pathname: string;
  pickingPhoto: boolean;
  /** sessionStorage 에 남긴 적용 시각. 없으면 0. */
  justUpdatedAt: number;
  now: number;
}): boolean {
  // 결제 추가 화면은 고른 사진·OCR 결과·입력값이 순수 메모리에만 있다. 새로 받으면 전부 날아간다.
  const addPayment = s.pathname.replace(/\/+$/, "").endsWith("/add");
  const justUpdated = s.now - s.justUpdatedAt < JUST_UPDATED_WINDOW_MS;
  return !s.online || s.pickingPhoto || justUpdated || addPayment;
}
