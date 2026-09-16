import { useRef, useState, type ChangeEvent } from "react";
import { OWNER_EMAIL, PIN_LENGTH, isPin, onlyDigits } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  // 실패 횟수. 칸 묶음의 key 로 써서 연속 실패해도 흔들림 애니메이션이 다시 재생되게 한다.
  const [fails, setFails] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 값을 인자로 받는다. 자동 로그인이 setState 비동기를 기다리지 않게 하려는 것.
  async function login(value: string) {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: value });
    setBusy(false);
    // 성공 시 App 의 onAuthStateChange 가 세션을 받아 /login → / 로 보낸다.
    if (error) {
      setError(true);
      setPin("");
      setFails((n) => n + 1);
      inputRef.current?.focus();
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    if (busy) return; // 로그인 요청 중에는 무시한다. disabled 로 막으면 모바일 키보드가 닫힌다.
    const value = onlyDigits(e.target.value);
    setPin(value);
    setError(false);
    if (isPin(value)) void login(value);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      <h1 className="mb-2 text-center text-3xl font-bold text-slate-900">SW2HW 장부</h1>
      <p className="mb-8 text-center text-sm text-slate-500">PIN 6자리를 입력하세요</p>

      <div className="relative">
        <div
          key={fails}
          aria-hidden="true"
          className={`flex justify-center gap-2 ${error ? "animate-pin-shake" : ""}`}
        >
          {Array.from({ length: PIN_LENGTH }, (_, i) => {
            const filled = i < pin.length;
            const next = focused && i === pin.length; // 다음에 입력될 칸
            return (
              <div
                key={i}
                className={`flex h-14 w-11 items-center justify-center rounded-xl border-2 ${
                  error
                    ? "border-red-500"
                    : filled || next
                      ? "border-slate-900"
                      : "border-slate-300"
                } ${next && !error ? "ring-4 ring-slate-900/10" : ""}`}
              >
                {filled && (
                  <span className={`h-3 w-3 rounded-full ${error ? "bg-red-500" : "bg-slate-900"}`} />
                )}
              </div>
            );
          })}
        </div>
        {/* 칸은 표시용이고 실제 입력은 이 투명 input 이 받는다. 칸 아무 곳이나 눌러도 키패드가 올라온다. */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          name="pin"
          maxLength={PIN_LENGTH}
          aria-label="PIN 6자리"
          aria-invalid={error}
          className="absolute inset-0 h-full w-full cursor-pointer text-transparent opacity-0 caret-transparent"
          value={pin}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus
        />
      </div>

      <div className="mt-4 min-h-6 text-center">
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            PIN이 올바르지 않습니다
          </p>
        ) : busy ? (
          <p className="text-sm text-slate-500">확인 중…</p>
        ) : null}
      </div>
    </main>
  );
}
