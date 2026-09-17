import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { btnPrimary, btnSecondary, h1, input, label } from "../components/ui";
import { autoCardId } from "../lib/cards";
import { fromDatetimeLocal, toDatetimeLocal } from "../lib/dates";
import { getOcrQuota, insertPayment, listCardBalances, uploadReceipt } from "../lib/db";
import { resizeToBlob, STORAGE_MAX_EDGE, STORAGE_QUALITY } from "../lib/image";
import { OcrError, recognizeReceipt } from "../lib/ocr";
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

/** 폼 칸을 채운 OCR 필드 이름. 그 칸을 고치면 "확인해 주세요" 표시를 지운다. */
const OCR_FIELD: Partial<Record<keyof Form, string>> = {
  cardId: "cardNumber",
  merchant: "merchant",
  amount: "amount",
  paidAt: "paidAt",
};

/** 두 제공자의 무료 한도가 모두 떨어졌을 때 쓰는 문구. 말풍선과 인식 실패 안내가 같은 문구를 쓴다. */
const QUOTA_MESSAGE = "이번 달 영수증 인식 한도를 모두 썼습니다. 직접 입력을 이용해 주세요";

/** 한도 소진 시 "영수증 입력" 버튼 모양. disabled 를 쓰면 탭 이벤트가 오지 않아 안내를 띄울 수 없다. */
const btnBlocked =
  "min-h-11 w-full cursor-not-allowed rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-400";

/** 확신 없는 칸 아래에 붙는 안내. */
function Check({ on }: { on: boolean }) {
  return on ? <span className="mt-1 block text-xs text-amber-600">확인해 주세요</span> : null;
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

/** 사진 보관은 결제의 덤이다. 실패해도 이미 저장된 결제를 되돌리지 않고 안내 한 줄만 남긴다. */
async function saveReceiptPhoto(paymentId: string, file: File) {
  try {
    const { blob } = await resizeToBlob(file, STORAGE_MAX_EDGE, STORAGE_QUALITY);
    await uploadReceipt(paymentId, blob);
  } catch {
    // 곧바로 홈으로 넘어가므로 화면 안내로는 보이지 않는다.
    window.alert("결제는 저장했지만 영수증 사진은 보관하지 못했습니다");
  }
}

export default function AddPayment() {
  const navigate = useNavigate();
  const [cards, setCards] = useState<CardBalance[]>([]);
  // undefined = 아직 "영수증 입력"/"직접 입력" 을 고르기 전
  const [form, setForm] = useState<Form>();
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // OCR 이 확신하지 못한 필드 이름들. 사용자가 그 칸을 고치면 빠진다.
  const [uncertain, setUncertain] = useState<string[]>([]);
  // 두 제공자의 무료 한도가 모두 떨어졌는가. 한도를 못 읽었으면 false 로 두어 버튼을 막지 않는다.
  const [quotaGone, setQuotaGone] = useState(false);
  const [tip, setTip] = useState(false);
  // 사진 File 은 저장이 끝날 때까지 들고 있다가 결제 id 를 받은 뒤 저장소에 올린다.
  const photoRef = useRef<File | null>(null);

  useEffect(() => {
    listCardBalances()
      .then(setCards)
      .catch((e) => setError((e as Error).message));
    // 읽기에 실패하면 막지 않는다. 그때는 인식 시도 중 429 를 받고 안내한다.
    getOcrQuota()
      .then((q) => setQuotaGone(!q.available))
      .catch(() => {});
  }, []);

  // 말풍선은 화면 아무 데나 누르면 닫힌다(버튼 자신의 클릭은 아래에서 전파를 막는다).
  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [tip]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...(f ?? blank()), [key]: value }));
    setUncertain((u) => u.filter((field) => field !== OCR_FIELD[key]));
  }

  const shaky = (field: string) => uncertain.includes(field);
  /** 확신 없는 칸은 테두리를 호박색으로 바꾼다. */
  const cls = (field: string) => (shaky(field) ? input.replace("border-slate-300", "border-amber-500") : input);

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
      setUncertain(r.uncertain ?? []);
      setForm({
        ...blank(),
        cardId: autoCardId(cards, r.cardNumber),
        merchant: r.merchant ?? "",
        amount: r.amount != null ? String(r.amount) : "",
        paidAt: r.paidAt ? toDatetimeLocal(r.paidAt) : toDatetimeLocal(new Date()),
        ocrCardNumber: r.cardNumber,
        source: "receipt",
      });
    } catch (err) {
      const exceeded = (err as OcrError).code === "quota_exceeded";
      if (exceeded) setQuotaGone(true);
      setNotice(exceeded ? QUOTA_MESSAGE : "영수증을 읽지 못했습니다. 직접 입력해 주세요");
      setUncertain([]);
      setForm(blank());
    } finally {
      setReading(false);
    }
  }

  function startManual() {
    photoRef.current = null;
    setUncertain([]);
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
      const id = await insertPayment({
        card_id: form.cardId,
        merchant: form.merchant.trim(),
        amount,
        paid_at: fromDatetimeLocal(form.paidAt),
        memo: form.memo.trim() || null,
        ocr_card_number: form.ocrCardNumber,
        source: form.source,
      });
      if (photoRef.current) await saveReceiptPhoto(id, photoRef.current);
      photoRef.current = null;
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
        <div className="relative">
          <label
            className={`${quotaGone ? btnBlocked : `${btnSecondary} w-full cursor-pointer`} flex h-full items-center justify-center`}
            aria-disabled={quotaGone || undefined}
            onClick={quotaGone
              ? (e) => {
                  e.stopPropagation(); // 아래 document 리스너가 곧바로 닫지 않도록
                  setTip((v) => !v);
                }
              : undefined}
          >
            영수증 입력
            {/* 한도가 떨어지면 input 을 두지 않는다. 라벨만 남아 파일 선택 창이 열리지 않는다. */}
            {!quotaGone && (
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPhoto}
                disabled={reading}
              />
            )}
          </label>
          {tip && (
            <div
              role="status"
              className="absolute inset-x-0 top-full z-10 mt-2 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"
            >
              <span className="absolute -top-1 left-6 size-2 rotate-45 bg-slate-900" />
              {QUOTA_MESSAGE}
            </div>
          )}
        </div>
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
              className={cls("cardNumber")}
              value={form.cardId}
              onChange={(e) => set("cardId", e.target.value)}
              required
            >
              <option value="">선택</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.card_prefix ? ` (${c.card_prefix}…)` : ""}
                </option>
              ))}
            </select>
            <Check on={shaky("cardNumber")} />
          </label>
          <label className="block">
            <span className={label}>가맹점</span>
            <input
              className={cls("merchant")}
              value={form.merchant}
              onChange={(e) => set("merchant", e.target.value)}
              maxLength={100}
              required
            />
            <Check on={shaky("merchant")} />
          </label>
          <label className="block">
            <span className={label}>금액(원)</span>
            <input
              className={cls("amount")}
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value.replace(/\D/g, ""))}
              required
            />
            <Check on={shaky("amount")} />
          </label>
          <label className="block">
            <span className={label}>결제 일시</span>
            <input
              type="datetime-local"
              className={`${cls("paidAt")} min-w-0 appearance-none [&::-webkit-date-and-time-value]:text-left`}
              value={form.paidAt}
              onChange={(e) => set("paidAt", e.target.value)}
              required
            />
            <Check on={shaky("paidAt")} />
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
