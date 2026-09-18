import { useCallback, useEffect, useState, type ReactNode } from "react";
import PaymentRow from "../components/PaymentRow";
import { btnDanger, btnPrimary, btnText, h1, input, label } from "../components/ui";
import { addMonths, formatKst, monthLabel, monthRange, todayKst } from "../lib/dates";
import {
  cancelPayment,
  getReceiptUrl,
  listCardBalances,
  listPaymentsByMonth,
  updatePaymentMemo,
} from "../lib/db";
import { userMessage } from "../lib/errors";
import { formatWon } from "../lib/money";
import type { CardBalance, PaymentWithCard } from "../lib/types";

function Row({ k, v, children }: { k: string; v?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right text-slate-900">{children ?? v}</dd>
    </div>
  );
}

/** 영수증 사진 전체 화면 보기. 시트(z-20)보다 위에 깔고 아무 곳이나 누르면 닫는다. */
function Zoom({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/90" onClick={onClose}>
      <img src={src} alt="영수증 사진" className="max-h-full max-w-full object-contain" />
      <button
        type="button"
        className="absolute right-2 top-2 min-h-11 min-w-11 text-xl text-white"
        onClick={onClose}
        aria-label="닫기"
      >
        ✕
      </button>
    </div>
  );
}

/** 상세 시트: 모든 필드 읽기 전용, 메모만 저장, 내역 취소(되돌릴 수 없음). */
function Sheet({
  p,
  onClose,
  onChanged,
}: {
  p: PaymentWithCard;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [memo, setMemo] = useState(p.memo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 사진은 시트를 열 때 저장소의 서명 URL 을 한 번만 받는다.
  // 없거나(직접 입력) 받지 못하면 아무것도 그리지 않는다.
  const [photo, setPhoto] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const canceled = !!p.canceled_at;

  useEffect(() => {
    getReceiptUrl(p.id)
      .then(setPhoto)
      .catch(() => {});
  }, [p.id]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(userMessage(e, "저장하지 못했습니다"));
      setBusy(false);
    }
  }

  function cancel() {
    if (window.confirm("이 결제를 취소하면 되돌릴 수 없습니다. 계속할까요?")) {
      run(() => cancelPayment(p.id));
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">결제 상세</h2>
          <button type="button" className={btnText} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        <dl className="mb-4 space-y-2 text-sm">
          <Row k="가맹점" v={p.merchant} />
          <Row k="금액" v={formatWon(p.amount)} />
          <Row k="카드" v={p.cards?.name ?? "-"} />
          <Row k="결제 일시" v={formatKst(p.paid_at)} />
          <Row k="출처" v={p.source === "receipt" ? "영수증" : "직접 입력"} />
          {p.ocr_card_number && <Row k="영수증 카드번호" v={p.ocr_card_number} />}
          {p.canceled_at && <Row k="상태" v={`취소됨 (${formatKst(p.canceled_at)})`} />}
          {photo && (
            <Row k="영수증 사진">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1 text-slate-900"
                onClick={() => setZoom(true)}
                aria-label="영수증 사진 크게 보기"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="8.5" cy="9.5" r="1.75" />
                  <path d="M4 17.5l4.5-4.5 3.5 3.5 3-3 5 5" />
                </svg>
              </button>
            </Row>
          )}
        </dl>
        <label className="block">
          <span className={label}>메모</span>
          <textarea
            className={`${input} h-auto py-2`}
            rows={2}
            maxLength={200}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <button
            type="button"
            className={`${btnPrimary} ${canceled ? "col-span-3" : "col-span-2"}`}
            disabled={busy}
            onClick={() => run(() => updatePaymentMemo(p.id, memo.trim() || null))}
          >
            저장
          </button>
          {!canceled && (
            <button type="button" className={btnDanger} disabled={busy} onClick={cancel}>
              내역 취소
            </button>
          )}
        </div>
        {zoom && photo && <Zoom src={photo} onClose={() => setZoom(false)} />}
      </div>
    </div>
  );
}

export default function Payments() {
  const [ym, setYm] = useState(() => {
    const [year, month] = todayKst().split("-").map(Number);
    return { year, month };
  });
  const [cardId, setCardId] = useState("");
  const [cards, setCards] = useState<CardBalance[]>([]);
  const [items, setItems] = useState<PaymentWithCard[]>();
  const [selected, setSelected] = useState<PaymentWithCard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listCardBalances()
      .then(setCards)
      .catch((e) => setError(userMessage(e, "카드 목록을 불러오지 못했습니다")));
  }, []);

  const load = useCallback(async () => {
    try {
      setItems(
        await listPaymentsByMonth({ ...monthRange(ym.year, ym.month), cardId: cardId || undefined }),
      );
    } catch (e) {
      setError(userMessage(e, "결제 내역을 불러오지 못했습니다"));
    }
  }, [ym, cardId]);

  useEffect(() => {
    setItems(undefined);
    load();
  }, [load]);

  const total = (items ?? []).filter((p) => !p.canceled_at).reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <h1 className={h1}>결제 내역</h1>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className={btnText}
          onClick={() => setYm(addMonths(ym.year, ym.month, -1))}
          aria-label="이전 달"
        >
          ◀
        </button>
        <span className="font-semibold text-slate-900">{monthLabel(ym.year, ym.month)}</span>
        <button
          type="button"
          className={btnText}
          onClick={() => setYm(addMonths(ym.year, ym.month, 1))}
          aria-label="다음 달"
        >
          ▶
        </button>
      </div>
      <select
        className={`${input} mb-3`}
        value={cardId}
        onChange={(e) => setCardId(e.target.value)}
        aria-label="카드 필터"
      >
        <option value="">전체 카드</option>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.card_prefix ? ` (${c.card_prefix}…)` : ""}
          </option>
        ))}
      </select>
      <p className="mb-4 flex justify-between rounded-lg bg-slate-100 px-3 py-2">
        <span className="text-slate-600">월 합계</span>
        <span className="font-bold text-slate-900">{formatWon(total)}</span>
      </p>

      {error && <p className="text-red-600">{error}</p>}
      {!items ? (
        <p className="text-slate-500">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-slate-500">이 달의 결제가 없습니다</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {items.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full py-3 text-left"
                onClick={() => setSelected(p)}
              >
                <PaymentRow p={p} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <Sheet
          key={selected.id}
          p={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </>
  );
}
