import { useEffect, useState } from "react";
import PaymentRow from "../components/PaymentRow";
import { h1, h2 } from "../components/ui";
import { listCardBalances, listRecentPayments, purgeOldPayments, rollOverBalances } from "../lib/db";
import { formatWon } from "../lib/money";
import type { CardBalance, PaymentWithCard } from "../lib/types";

export default function Home() {
  const [cards, setCards] = useState<CardBalance[]>();
  const [recent, setRecent] = useState<PaymentWithCard[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      // 잔액 기간이 지난 카드를 먼저 채우고, 그다음 3개월 지난 결제를 정리한다. 실패해도 화면은 진행한다.
      await rollOverBalances().catch(() => {});
      await purgeOldPayments().catch(() => {});
      try {
        const [c, r] = await Promise.all([listCardBalances(), listRecentPayments(5)]);
        setCards(c);
        setRecent(r);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  const total = (cards ?? []).reduce((s, c) => s + c.balance, 0);

  return (
    <>
      <h1 className={h1}>홈</h1>
      {error ? (
        <p className="text-red-600">{error}</p>
      ) : !cards ? (
        <p className="text-slate-500">불러오는 중…</p>
      ) : (
        <>
          <section className="mb-6 rounded-xl bg-slate-900 p-5 text-white">
            <p className="text-sm text-slate-300">총 잔액</p>
            <p className={`text-3xl font-bold ${total < 0 ? "text-red-400" : ""}`}>{formatWon(total)}</p>
          </section>

          <h2 className={h2}>카드별 잔액</h2>
          {cards.length === 0 ? (
            <p className="mb-6 text-slate-500">등록된 카드가 없습니다</p>
          ) : (
            <ul className="mb-6 divide-y divide-slate-200">
              {cards.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-3">
                  <span>
                    {c.name}
                    {c.card_prefix && <span className="ml-2 text-sm text-slate-500">{c.card_prefix}…</span>}
                  </span>
                  <span className={`font-semibold ${c.balance < 0 ? "text-red-600" : ""}`}>
                    {formatWon(c.balance)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2 className={h2}>최근 결제</h2>
          {recent.length === 0 ? (
            <p className="text-slate-500">결제가 없습니다</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {recent.map((p) => (
                <li key={p.id} className="py-3">
                  <PaymentRow p={p} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
