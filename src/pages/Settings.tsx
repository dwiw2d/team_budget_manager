import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { btnPrimary, btnSecondary, h1, h2, input, label } from "../components/ui";
import { OWNER_EMAIL, PIN_LENGTH, isPin, onlyDigits } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function Settings() {
  const navigate = useNavigate();
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePin(e: FormEvent) {
    e.preventDefault();
    setMessage("");
    setError("");
    if (!isPin(currentPin)) return setError("현재 PIN 6자리를 입력하세요");
    if (!isPin(pin)) return setError("새 PIN 은 숫자 6자리여야 합니다");
    if (pin !== pin2) return setError("새 PIN 이 일치하지 않습니다");
    if (pin === currentPin) return setError("현재 PIN 과 다른 PIN 을 입력하세요");
    setBusy(true);
    // 같은 계정으로 다시 로그인해 현재 PIN 을 확인한다. 세션만 갱신될 뿐 부작용은 없다.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: OWNER_EMAIL,
      password: currentPin,
    });
    if (signInError) {
      setBusy(false);
      return setError("현재 PIN 이 올바르지 않습니다");
    }
    const { error } = await supabase.auth.updateUser({ password: pin });
    setBusy(false);
    if (error) return setError(error.message);
    setCurrentPin("");
    setPin("");
    setPin2("");
    setMessage("PIN 을 변경했습니다");
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <>
      <h1 className={h1}>설정</h1>

      <h2 className={h2}>PIN 변경</h2>
      <form onSubmit={changePin} className="mb-8 space-y-3">
        <label className="block">
          <span className={label}>현재 PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={PIN_LENGTH}
            className={input}
            autoComplete="current-password"
            value={currentPin}
            onChange={(e) => setCurrentPin(onlyDigits(e.target.value))}
            required
          />
        </label>
        <label className="block">
          <span className={label}>새 PIN</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={PIN_LENGTH}
            className={input}
            autoComplete="new-password"
            value={pin}
            onChange={(e) => setPin(onlyDigits(e.target.value))}
            required
          />
        </label>
        <label className="block">
          <span className={label}>새 PIN 확인</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={PIN_LENGTH}
            className={input}
            autoComplete="new-password"
            value={pin2}
            onChange={(e) => setPin2(onlyDigits(e.target.value))}
            required
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}
        <button type="submit" className={btnPrimary} disabled={busy}>
          {busy ? "변경 중…" : "PIN 변경"}
        </button>
      </form>

      <button type="button" className={`${btnSecondary} w-full`} onClick={logout}>
        로그아웃
      </button>

      <p className="mt-8 text-center text-sm text-slate-500">SW2HW 장부 v{__APP_VERSION__}</p>
    </>
  );
}
