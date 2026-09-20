import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { JUST_UPDATED_KEY, PHOTO_PICKER_KEY, shouldSkipGate } from "./lib/startup";

/**
 * 관문의 한 단계를 묶는 상한. 확인(sw.js 를 받고 새 워커가 설치를 마치기까지, 프리캐시 약 550KB)과
 * 적용(SKIP_WAITING 을 보내고 제어권이 넘어오기까지)에 같은 값을 쓴다.
 *
 * 로컬 루프백에서 확인 한 번이 1.5~2.4초 걸리는 것을 재어 보았다. 실제 네트워크는 더 걸리므로
 * 3초로는 멀쩡한 갱신도 놓친다. 적용도 짧게 잡으면 안 된다 — 단념한 뒤에는 새 워커가 이미
 * 활성이라 대기 중인 워커가 없고, 다음 관문이 "최신" 으로 보아 그냥 통과한다. 즉 한 번 단념하면
 * 앱을 껐다 켜기 전까지 옛 코드에 머문다. 기다리는 동안은 스플래시가 덮고 있어 잃을 것이 없다.
 *
 * 실패하면 재시도 1회라 앱이 열리기까지 최악 12초다. 더 늘리면 기다림이 눈에 띈다.
 */
const TIMEOUT_MS = 6000;

const CHECKING = "업데이트 확인 중";
const APPLYING = "업데이트 진행 중";
const FAILED = "업데이트를 확인하지 못했습니다";

/** 상한을 넘으면 거절한다. 관문의 모든 네트워크·업데이트 호출이 이 안에서 돈다. */
const withTimeout = <T,>(p: Promise<T>, ms = TIMEOUT_MS) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("시간 초과")), ms)),
  ]);

/** 서버에 새 워커가 있는지 물어본다. 대기 중인 워커가 있으면 true. */
async function hasWaitingWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false; // 첫 방문이라 아직 등록 전이면 확인할 것이 없다
  // 공식 주기 점검 레시피대로 워커 스크립트를 캐시 없이 한 번 받아 본다.
  const swUrl = reg.active?.scriptURL;
  if (swUrl) {
    const res = await fetch(swUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`서비스 워커 응답 ${res.status}`);
  }
  await reg.update();
  // update() 는 설치가 끝나기 전에 풀린다. 여기서 안 기다리면 새 버전을 놓치고 다음 실행에야 본다.
  const installing = reg.installing;
  if (installing) {
    await new Promise<void>((done) => {
      installing.addEventListener("statechange", () => installing.state !== "installing" && done());
    });
  }
  // workbox 의 waiting 이벤트는 설치 200ms 뒤에야 오므로 registration 을 직접 본다.
  return reg.waiting != null;
}

/**
 * 시작 관문. 처음 마운트될 때와 백그라운드에서 돌아올 때 스플래시를 덮고 업데이트를 확인한다.
 * 앱은 계속 붙여 둔 채 위를 가리기만 한다 — 떼었다 붙이면 쓰던 화면의 입력이 날아간다.
 */
export default function StartupGate({ children }: { children: ReactNode }) {
  // 서비스 워커 등록은 여기 한 곳에서만 한다. registerType 이 'prompt' 라 대기 중인 워커는
  // updateServiceWorker(true) 를 부를 때까지 화면을 넘겨받지 않는다.
  //
  // onNeedReload 로 플러그인의 자동 새로고침을 꺼 둔다. 끄지 않으면 plugin 이 workbox 의 waiting
  // 이벤트에서 스스로 단 controlling 리스너가 제어권 전환을 보고 location.reload() 를 부른다.
  // 그 리스너는 우리가 단 것이 아니라 아래 AbortController 로 걷지 못하므로, 관문이 적용을 단념한
  // 뒤 늦게 제어권이 넘어오면 사용자가 입력하는 도중에 페이지가 새로고침돼 입력값이 날아갔다.
  // 새로고침 시점은 아래에서 우리가 직접 고른다 — 관문이 화면을 덮고 있는 동안에만.
  const { updateServiceWorker } = useRegisterSW({ onNeedReload: () => {} });
  // null 이면 관문이 걷히고 앱만 보인다. 문자열이면 스플래시 하단에 그 문구가 붙는다.
  const [status, setStatus] = useState<string | null>(CHECKING);
  const running = useRef(false);

  useEffect(() => {
    async function run() {
      if (running.current) return;
      running.current = true;
      setStatus(CHECKING);
      try {
        const skip = shouldSkipGate({
          online: navigator.onLine,
          pathname: window.location.pathname,
          pickingPhoto: sessionStorage.getItem(PHOTO_PICKER_KEY) !== null,
          justUpdatedAt: Number(sessionStorage.getItem(JUST_UPDATED_KEY)) || 0,
          now: Date.now(),
        });
        // 사진 표시는 한 번 쓰고 지운다. 적용 시각은 창이 지나면 저절로 무의미해진다.
        sessionStorage.removeItem(PHOTO_PICKER_KEY);
        if (skip) return;

        let waiting = false;
        try {
          waiting = await withTimeout(hasWaitingWorker());
        } catch {
          setStatus(FAILED);
          try {
            waiting = await withTimeout(hasWaitingWorker());
          } catch {
            return; // 재시도까지 실패하면 그냥 통과한다 — 관문이 앱을 막으면 안 된다
          }
        }
        if (!waiting) return; // 최신이면 아무 안내 없이 앱으로

        setStatus(APPLYING);
        // 새 워커가 화면을 넘겨받으면 새 코드로 다시 받는다. once 라 한 번만 돈다.
        const stop = new AbortController();
        navigator.serviceWorker.addEventListener(
          "controllerchange",
          () => window.location.reload(),
          { once: true, signal: stop.signal },
        );
        sessionStorage.setItem(JUST_UPDATED_KEY, String(Date.now()));
        // 새로고침이 오면 여기서 화면이 사라진다. 상한 안에 안 오면 단념하고 앱을 연다 —
        // 이번 갱신은 앱을 껐다 켤 때까지 놓치되, 리스너를 걷었으니 늦게 제어권이 넘어와도
        // 쓰던 화면이 새로고침되지는 않는다. 플러그인 리스너는 위에서 이미 꺼 두었다.
        await withTimeout(updateServiceWorker(true).then(() => new Promise(() => {}))).catch(() => {});
        stop.abort();
      } finally {
        setStatus(null);
        running.current = false;
      }
    }

    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    // iOS 의 visibilitychange 는 더러 빠진다고 알려져 있어 bfcache 복귀는 pageshow 로 한 번 더 받는다.
    // 평범한 로드에서도 오는 pageshow 는 거른다(persisted) — 마운트 실행과 겹쳐 봐야 위 가드에 막힌다.
    const onPageShow = (e: PageTransitionEvent) => e.persisted && void run();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [updateServiceWorker]);

  return (
    <>
      {children}
      {status !== null && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-white px-4">
          <p className="text-xl font-bold text-slate-900">SW2HW 장부</p>
          <span
            aria-hidden
            className="size-6 rounded-full border-2 border-slate-200 border-t-slate-900 motion-safe:animate-spin"
          />
          <p
            role="status"
            className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+2rem)] px-4 text-center text-sm text-slate-500"
          >
            {status}
          </p>
        </div>
      )}
    </>
  );
}
