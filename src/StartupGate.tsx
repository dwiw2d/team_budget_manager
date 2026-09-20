import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { JUST_UPDATED_KEY, PHOTO_PICKER_KEY, shouldSkipGate } from "./lib/startup";

/**
 * 확인 한 번의 상한. sw.js 를 받고 새 워커가 설치를 마치기까지를 덮는다(프리캐시 약 550KB).
 * 실패하면 재시도 1회라 앱이 열리기까지 최악 6초로 묶인다. 더 늘리면 기다림이 눈에 띈다.
 */
const TIMEOUT_MS = 3000;

/**
 * 적용 뒤 새로고침을 기다리는 상한. 확인보다 짧게 둔다 — 여기서는 이미 받아 둔 워커에 메시지만
 * 보내면 되므로 오래 걸릴 일이 없다. 어떤 이유로든 controllerchange 가 안 오면 그냥 앱을 연다.
 */
const RELOAD_TIMEOUT_MS = 2000;

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
  const { updateServiceWorker } = useRegisterSW();
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
        // 이번 갱신은 놓치지만 다음 관문에서 다시 잡는다.
        await withTimeout(updateServiceWorker(true).then(() => new Promise(() => {})), RELOAD_TIMEOUT_MS)
          .catch(() => {});
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
