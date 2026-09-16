import { useState, type ChangeEvent, type FormEvent } from "react";
import { btnPrimary, input } from "../components/ui";
import { OWNER_EMAIL, PIN_LENGTH, isPin, onlyDigits } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // 값을 인자로 받는다. 자동 로그인이 setState 비동기를 기다리지 않게 하려는 것.
  async function login(value: string) {
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password: value });
    setBusy(false);
    // 성공 시 App 의 onAuthStateChange 가 세션을 받아 /login → / 로 보낸다.
    if (error) {
      setError("PIN이 올바르지 않습니다");
      setPin("");
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const value = onlyDigits(e.target.value);
    setPin(value);
    setError("");
    if (value.length === PIN_LENGTH && !busy) void login(value);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void login(pin);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      <h1 className="mb-2 text-center text-3xl font-bold text-slate-900">SW2HW 장부</h1>
      <p className="mb-8 text-center text-sm text-slate-500">PIN 6자리를 입력하세요</p>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={PIN_LENGTH}
          className={`${input} text-center text-2xl tracking-[0.5em]`}
          autoComplete="current-password"
          value={pin}
          onChange={onChange}
          autoFocus
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={btnPrimary} disabled={busy || !isPin(pin)}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}
