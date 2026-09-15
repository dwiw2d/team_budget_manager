import { describe, expect, it } from "vitest";
import { autoCardId } from "./cards";

const cards = [
  { id: "a", last4: "5678" },
  { id: "b", last4: "3456" },
  { id: "c", last4: null },
];

describe("autoCardId", () => {
  it("공백·하이픈을 걷어낸 뒤 끝 4자리가 last4 와 같은 카드가 하나면 선택한다", () => {
    expect(autoCardId(cards, "1234-56**-****-5678")).toBe("a");
    expect(autoCardId(cards, "1234 56** **** 56 78 ")).toBe("a");
    expect(autoCardId(cards, "5678-")).toBe("a");
  });

  it("끝이 마스킹되면 가운데 숫자(3456)로 맞추지 않는다", () => {
    expect(autoCardId(cards, "1234-56**-****-****")).toBe("");
    expect(autoCardId(cards, "1234-5678-****-****")).toBe("");
    expect(autoCardId(cards, "3456-****")).toBe("");
  });

  it("일치하는 카드가 둘이거나 없거나 번호가 없으면 선택하지 않는다", () => {
    expect(autoCardId([...cards, { id: "d", last4: "5678" }], "5678")).toBe("");
    expect(autoCardId(cards, "0000")).toBe("");
    expect(autoCardId(cards, "678")).toBe("");
    expect(autoCardId(cards, null)).toBe("");
    expect(autoCardId(cards, "")).toBe("");
  });
});
