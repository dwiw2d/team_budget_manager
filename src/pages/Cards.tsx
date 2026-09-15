import { useEffect, useState, type FormEvent } from "react";
import { btnPrimary, btnSecondary, btnText, h1, input, label } from "../components/ui";
import { todayKst } from "../lib/dates";
import {
  deleteCard,
  insertCard,
  listCardBalances,
  resetAllCards,
  resetCard,
  updateCard,
} from "../lib/db";
import { formatWon } from "../lib/money";
import type { CardBalance } from "../lib/types";

interface Editing {
  id?: string;
  name: string;
  initial: string;
  last4: string;
}

/** 초기화 기준일 입력(기본 오늘) + 확인. 카드별과 전체가 같은 패널을 쓴다. */
function ResetPanel({
  date,
  busy,
  onDate,
  onConfirm,
  onClose,
}: {
  date: string;
  busy: boolean;
  onDate: (d: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="my-2 rounded-lg bg-slate-100 p-3">
      <label className="block">
        <span className={label}>초기화 기준일</span>
        <input type="date" className={input} value={date} onChange={(e) => onDate(e.target.value)} />
      </label>
      <div className="mt-2 flex gap-2">
        <button type="button" className={`${btnPrimary} flex-1`} disabled={busy || !date} onClick={onConfirm}>
          초기화
        </button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

export default function Cards() {
  const [cards, setCards] = useState<CardBalance[]>();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [reset, setReset] = useState<{ id: string | "all"; date: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    listCardBalances()
      .then(setCards)
      .catch((e) => setError((e as Error).message));

  useEffect(() => {
    load();
  }, []);

  /** 저장 계열 공통: 실행 → 목록 재로드. 성공 여부를 돌려준다. */
  async function run(fn: () => Promise<void>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveCard(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return setError("이름을 입력하세요");
    if (!/^\d+$/.test(editing.initial)) return setError("초기 잔액은 0 이상의 정수여야 합니다");
    if (editing.last4 && !/^\d{4}$/.test(editing.last4)) return setError("뒤 4자리는 숫자 4자리여야 합니다");
    const c = { name, initial_balance: Number(editing.initial), last4: editing.last4 || null };
    const id = editing.id;
    if (await run(() => (id ? updateCard(id, c) : insertCard(c)))) setEditing(null);
  }

  async function confirmReset() {
    if (!reset) return;
    const target = reset.id === "all" ? "모든 카드의" : "이 카드의";
    if (!window.confirm(`${target} 잔액을 ${reset.date} 기준으로 초기 잔액으로 되돌립니다. 계속할까요?`)) return;
    const { id, date } = reset;
    if (await run(() => (id === "all" ? resetAllCards(date) : resetCard(id, date)))) setReset(null);
  }

  function remove(c: CardBalance) {
    if (window.confirm(`'${c.name}' 카드를 삭제할까요?`)) run(() => deleteCard(c.id));
  }

  return (
    <>
      <h1 className={h1}>카드</h1>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <button
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => setEditing({ name: "", initial: "", last4: "" })}
        >
          카드 추가
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={busy || !cards?.length}
          onClick={() => setReset({ id: "all", date: todayKst() })}
        >
          모든 카드 초기화
        </button>
      </div>

      {reset?.id === "all" && (
        <ResetPanel
          date={reset.date}
          busy={busy}
          onDate={(date) => setReset({ ...reset, date })}
          onConfirm={confirmReset}
          onClose={() => setReset(null)}
        />
      )}

      {editing && (
        <form onSubmit={saveCard} className="mb-4 space-y-3 rounded-lg border border-slate-200 p-3">
          <p className="font-semibold text-slate-900">{editing.id ? "카드 수정" : "카드 추가"}</p>
          <label className="block">
            <span className={label}>이름</span>
            <input
              className={input}
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              maxLength={40}
              required
            />
          </label>
          <label className="block">
            <span className={label}>초기 잔액(원)</span>
            <input
              className={input}
              inputMode="numeric"
              pattern="[0-9]*"
              value={editing.initial}
              onChange={(e) => setEditing({ ...editing, initial: e.target.value.replace(/\D/g, "") })}
              required
            />
          </label>
          <label className="block">
            <span className={label}>카드번호 뒤 4자리(선택)</span>
            <input
              className={input}
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              value={editing.last4}
              onChange={(e) => setEditing({ ...editing, last4: e.target.value.replace(/\D/g, "") })}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className={`${btnPrimary} flex-1`} disabled={busy}>
              저장
            </button>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(null)}>
              닫기
            </button>
          </div>
        </form>
      )}

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {!cards ? (
        <p className="text-slate-500">불러오는 중…</p>
      ) : cards.length === 0 ? (
        <p className="text-slate-500">등록된 카드가 없습니다</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {cards.map((c) => (
            <li key={c.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    {c.name}
                    {c.last4 && <span className="ml-2 text-sm font-normal text-slate-500">•{c.last4}</span>}
                  </p>
                  <p className="text-sm text-slate-500">초기 잔액 {formatWon(c.initial_balance)}</p>
                  <p className="text-sm text-slate-500">
                    {c.reset_date ? `초기화 기준일 ${c.reset_date}` : "초기화 전"}
                  </p>
                </div>
                <p className={`text-lg font-bold ${c.balance < 0 ? "text-red-600" : "text-slate-900"}`}>
                  {formatWon(c.balance)}
                </p>
              </div>
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  className={btnText}
                  disabled={busy}
                  onClick={() => setEditing({ id: c.id, name: c.name, initial: String(c.initial_balance), last4: c.last4 ?? "" })}
                >
                  수정
                </button>
                <button
                  type="button"
                  className={btnText}
                  disabled={busy}
                  onClick={() => setReset({ id: c.id, date: todayKst() })}
                >
                  초기화
                </button>
                <button type="button" className={`${btnText} text-red-600`} disabled={busy} onClick={() => remove(c)}>
                  삭제
                </button>
              </div>
              {reset?.id === c.id && (
                <ResetPanel
                  date={reset.date}
                  busy={busy}
                  onDate={(date) => setReset({ ...reset, date })}
                  onConfirm={confirmReset}
                  onClose={() => setReset(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
