import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { btnPrimary, btnSecondary, h1, h2, input, label } from "../components/ui";
import { supabase } from "../lib/supabase";

export default function Settings() {
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (pw.length < 8) return setError("비밀번호는 8자 이상이어야 합니다");
    if (pw !== pw2) return setError("두 비밀번호가 일치하지 않습니다");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setError(error.message);
    setPw("");
    setPw2("");
    setMessage("비밀번호를 변경했습니다");
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <>
      <h1 className={h1}>설정</h1>

      <h2 className={h2}>비밀번호 변경</h2>
      <form onSubmit={changePassword} className="mb-8 space-y-3">
        <label className="block">
          <span className={label}>새 비밀번호(8자 이상)</span>
          <input
            type="password"
            className={input}
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className={label}>새 비밀번호 확인</span>
          <input
            type="password"
            className={input}
            autoComplete="new-password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? "변경 중…" : "비밀번호 변경"}
        </button>
      </form>

      <button type="button" className={`${btnSecondary} w-full`} onClick={logout}>
        로그아웃
      </button>

      <p className="mt-8 text-center text-sm text-slate-500">SW2HW 장부 v{__APP_VERSION__}</p>
    </>
  );
}
