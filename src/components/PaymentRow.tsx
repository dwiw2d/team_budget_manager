import { formatKst } from "../lib/dates";
import { formatWon } from "../lib/money";
import type { PaymentWithCard } from "../lib/types";

/** 결제 한 줄(가맹점, 카드 이름, 일시, 금액). 취소 건은 취소선 + "취소됨". */
export default function PaymentRow({ p }: { p: PaymentWithCard }) {
  const strike = p.canceled_at ? "line-through text-slate-400" : "";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0">
        <span className={`block truncate font-medium ${strike}`}>{p.merchant}</span>
        <span className="block text-sm text-slate-500">
          {p.cards?.name ?? "-"} · {formatKst(p.paid_at)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`block font-semibold ${strike}`}>{formatWon(p.amount)}</span>
        {p.canceled_at && (
          <span className="inline-block rounded bg-slate-200 px-1.5 text-xs text-slate-600">취소됨</span>
        )}
      </span>
    </div>
  );
}
