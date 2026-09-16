import { useEffect, useState, type FormEvent } from "react";
import { btnDanger, btnPrimary, btnSecondary, btnText, h1, input, label } from "../components/ui";
import { deleteCard, insertCard, listCardBalances, updateCard } from "../lib/db";
import { formatWon } from "../lib/money";
import type { CardBalance } from "../lib/types";

interface Editing {
  id?: string;
  name: string;
  initial: string;
  prefix: string;
}

function Row({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd className={`text-right ${danger ? "text-red-600" : "text-slate-900"}`}>{v}</dd>
    </div>
  );
}

export default function Cards() {
  const [cards, setCards] = useState<CardBalance[]>();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  /** 상세 시트에 보이는 카드. 항상 최신 목록에서 찾고, 없으면 시트가 닫힌다. */
  const selected = cards?.find((c) => c.id === selectedId);

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
    if (editing.prefix && !/^\d{6,8}$/.test(editing.prefix))
      return setError("카드번호 앞자리는 숫자 6~8자리여야 합니다");
    const c = { name, initial_balance: Number(editing.initial), card_prefix: editing.prefix || null };
    const id = editing.id;
    if (await run(() => (id ? updateCard(id, c) : insertCard(c)))) setEditing(null);
  }

  function closeSheet() {
    setSelectedId(null);
  }

  function edit(c: CardBalance) {
    closeSheet();
    setError("");
    setEditing({ id: c.id, name: c.name, initial: String(c.initial_balance), prefix: c.card_prefix ?? "" });
  }

  async function remove(c: CardBalance) {
    if (window.confirm(`'${c.name}' 카드를 삭제할까요?`) && (await run(() => deleteCard(c.id)))) closeSheet();
  }

  return (
    <>
      <h1 className={h1}>카드</h1>
      <div className="mb-4">
        <button
          type="button"
          className={`${btnSecondary} w-full`}
          disabled={busy}
          onClick={() => { setError(""); setEditing({ name: "", initial: "", prefix: "" }); }}
        >
          카드 추가
        </button>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setEditing(null)}
        >
          <form
            onSubmit={saveCard}
            role="dialog"
            aria-modal="true"
            aria-label={editing.id ? "카드 수정" : "카드 추가"}
            className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
          <p className="text-lg font-bold text-slate-900">{editing.id ? "카드 수정" : "카드 추가"}</p>
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
            <span className="mt-1 block text-xs text-slate-500">
              초기 잔액을 바꾸면 다음 달 1일부터 적용됩니다
            </span>
          </label>
          <label className="block">
            <span className={label}>카드번호 앞 6~8자리(선택)</span>
            <input
              className={input}
              inputMode="numeric"
              pattern="[0-9]{6,8}"
              maxLength={8}
              value={editing.prefix}
              onChange={(e) => setEditing({ ...editing, prefix: e.target.value.replace(/\D/g, "") })}
            />
            <span className="mt-1 block text-xs text-slate-500">
              영수증은 뒤 4자리를 가리므로 앞자리로 맞춥니다
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className={`${btnPrimary} flex-1`} disabled={busy}>
              저장
            </button>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => setEditing(null)}>
              닫기
            </button>
          </div>
          </form>
        </div>
      )}

      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="카드 상세"
          className="fixed inset-0 z-20 flex items-end bg-black/40"
          onClick={() => !busy && closeSheet()}
        >
          <div
            className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">카드 상세</h2>
              <button type="button" className={btnText} disabled={busy} onClick={closeSheet} aria-label="닫기">
                ✕
              </button>
            </div>
            <dl className="mb-4 space-y-2 text-sm">
              <Row k="이름" v={selected.name} />
              <Row k="카드번호 앞자리" v={selected.card_prefix ?? "-"} />
              <Row k="초기 잔액" v={formatWon(selected.initial_balance)} />
              <p className="text-xs text-slate-500">초기 잔액을 바꾸면 다음 달 1일부터 적용됩니다</p>
              <Row k="잔액" v={formatWon(selected.balance)} danger={selected.balance < 0} />
            </dl>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => edit(selected)}>
                수정
              </button>
              <button type="button" className={btnDanger} disabled={busy} onClick={() => remove(selected)}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {error && !editing && !selected && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {!cards ? (
        <p className="text-slate-500">불러오는 중…</p>
      ) : cards.length === 0 ? (
        <p className="text-slate-500">등록된 카드가 없습니다</p>
      ) : (
        <ul className="divide-y divide-slate-200">
          {cards.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="min-h-11 w-full py-3 text-left"
                onClick={() => { setError(""); setSelectedId(c.id); }}
              >
                <span className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-semibold text-slate-900">
                      {c.name}
                      {c.card_prefix && (
                        <span className="ml-2 text-sm font-normal text-slate-500">{c.card_prefix}…</span>
                      )}
                    </span>
                    <span className="block text-sm text-slate-500">초기 잔액 {formatWon(c.initial_balance)}</span>
                  </span>
                  <span className={`text-lg font-bold ${c.balance < 0 ? "text-red-600" : "text-slate-900"}`}>
                    {formatWon(c.balance)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
