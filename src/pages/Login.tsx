import { useState, type FormEvent } from "react";
import { btnPrimary, input } from "../components/ui";
import { OWNER_EMAIL } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email: OWNER_EMAIL, password });
    setBusy(false);
    // 성공 시 App 의 onAuthStateChange 가 세션을 받아 /login → / 로 보낸다.
    if (error) setError("비밀번호가 올바르지 않습니다");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4">
      <h1 className="mb-8 text-center text-3xl font-bold text-slate-900">SW2HW 장부</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="password"
          className={input}
          placeholder="비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? "로그인 중…" : "로그인"}
        </button>
      </form>
    </main>
  );
}
