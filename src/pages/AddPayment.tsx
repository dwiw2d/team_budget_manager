import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { btnPrimary, btnSecondary, h1, input, label } from "../components/ui";
import { fromDatetimeLocal, toDatetimeLocal } from "../lib/dates";
import { insertPayment, listCardBalances } from "../lib/db";
import { recognizeReceipt } from "../lib/ocr";
import type { CardBalance, PaymentSource } from "../lib/types";

interface Form {
  cardId: string;
  merchant: string;
  amount: string;
  paidAt: string;
  memo: string;
  ocrCardNumber: string | null;
  source: PaymentSource;
}

const blank = (): Form => ({
  cardId: "",
  merchant: "",
  amount: "",
  paidAt: toDatetimeLocal(new Date()),
  memo: "",
  ocrCardNumber: null,
  source: "manual",
});

/** 읽은 카드번호의 마지막 4자리와 last4 가 같은 카드가 정확히 하나일 때만 그 카드 id */
function autoCardId(cards: CardBalance[], cardNumber: string | null): string {
  const digits = (cardNumber ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  const matches = cards.filter((c) => c.last4 === digits.slice(-4));
  return matches.length === 1 ? matches[0].id : "";
}

export default function AddPayment() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<CardBalance[]>([]);
  // undefined = 아직 "영수증 촬영"/"직접 입력" 을 고르기 전
  const [form, setForm] = useState<Form>();
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 스펙 결정 6: 사진 File 은 저장 완료까지 보관한다(나중에 업로드 단계를 끼울 자리).
  const photoRef = useRef<File | null>(null);

  useEffect(() => {
    listCardBalances()
      .then(setCards)
      .catch((e) => setError((e as Error).message));
  }, []);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...(f ?? blank()), [key]: value }));
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 change 가 나게
    if (!file) return;
    photoRef.current = file;
    setNotice("");
    setError("");
    setReading(true);
    try {
      const r = await recognizeReceipt(file);
      setForm({
        ...blank(),
        cardId: autoCardId(cards, r.cardNumber),
        merchant: r.merchant ?? "",
        amount: r.amount != null ? String(r.amount) : "",
        paidAt: r.paidAt ? toDatetimeLocal(r.paidAt) : toDatetimeLocal(new Date()),
        ocrCardNumber: r.cardNumber,
        source: "receipt",
      });
    } catch {
      setNotice("영수증을 읽지 못했습니다. 직접 입력해 주세요");
      setForm(blank());
    } finally {
      setReading(false);
    }
  }

  function startManual() {
    photoRef.current = null;
    setNotice("");
    setError("");
    setForm(blank());
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const amount = Number(form.amount);
    if (!form.cardId) return setError("카드를 선택하세요");
    if (!form.merchant.trim()) return setError("가맹점을 입력하세요");
    if (!/^\d+$/.test(form.amount) || amount <= 0) return setError("금액은 양의 정수여야 합니다");
    if (!form.paidAt) return setError("결제 일시를 입력하세요");
    setBusy(true);
    setError("");
    try {
      await insertPayment({
        card_id: form.cardId,
        merchant: form.merchant.trim(),
        amount,
        paid_at: fromDatetimeLocal(form.paidAt),
        memo: form.memo.trim() || null,
        ocr_card_number: form.ocrCardNumber,
        source: form.source,
      });
      photoRef.current = null; // 사진은 보관하지 않는다
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className={h1}>결제 추가</h1>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className={`${btnSecondary} flex cursor-pointer items-center justify-center`}>
          영수증 촬영
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={onPhoto}
            disabled={reading}
          />
        </label>
        <button type="button" className={btnSecondary} onClick={startManual} disabled={reading}>
          직접 입력
        </button>
      </div>

      {reading && <p className="text-slate-500">영수증을 읽는 중…</p>}
      {notice && <p className="mb-3 text-red-600">{notice}</p>}

      {form && !reading && (
        <form onSubmit={onSubmit} className="space-y-3">
          {form.ocrCardNumber && (
            <div>
              <span className={label}>영수증 카드번호</span>
              <p className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{form.ocrCardNumber}</p>
            </div>
          )}
          <label className="block">
            <span className={label}>카드</span>
            <select
              className={input}
              value={form.cardId}
              onChange={(e) => set("cardId", e.target.value)}
              required
            >
              <option value="">선택</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.last4 ? ` (${c.last4})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>가맹점</span>
            <input
              className={input}
              value={form.merchant}
              onChange={(e) => set("merchant", e.target.value)}
              maxLength={100}
              required
            />
          </label>
          <label className="block">
            <span className={label}>금액(원)</span>
            <input
              className={input}
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value.replace(/\D/g, ""))}
              required
            />
          </label>
          <label className="block">
            <span className={label}>결제 일시</span>
            <input
              type="datetime-local"
              className={input}
              value={form.paidAt}
              onChange={(e) => set("paidAt", e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className={label}>메모(선택)</span>
            <textarea
              className={`${input} h-auto py-2`}
              rows={2}
              maxLength={200}
              value={form.memo}
              onChange={(e) => set("memo", e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className={btnPrimary} disabled={busy}>
            {busy ? "저장 중…" : "저장"}
          </button>
        </form>
      )}
      {!form && !reading && error && <p className="text-sm text-red-600">{error}</p>}
    </>
  );
}
