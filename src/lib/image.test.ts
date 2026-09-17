import { describe, expect, it } from "vitest";
// canvas 가 없는 환경이라 resizeToDataUrl·resizeToBlob 은 부르지 않는다. 순수 함수만 본다.
import { scaleFor, stripDataUrlPrefix } from "./image";

describe("stripDataUrlPrefix", () => {
  it("접두어를 떼고 base64 본문만 남긴다", () => {
    expect(stripDataUrlPrefix("data:image/jpeg;base64,AAAB")).toBe("AAAB");
  });

  it("구분자가 없으면 그대로 돌려준다", () => {
    expect(stripDataUrlPrefix("AAAB")).toBe("AAAB");
  });
});

describe("scaleFor", () => {
  it("긴 변이 maxEdge 이하면 확대하지 않는다", () => {
    expect(scaleFor(800, 600, 1200)).toBe(1);
    expect(scaleFor(1200, 1200, 1200)).toBe(1);
  });

  it("가로든 세로든 긴 변을 기준으로 줄인다", () => {
    expect(scaleFor(2400, 1200, 1200)).toBe(0.5);
    expect(scaleFor(1200, 2400, 1200)).toBe(0.5);
  });

  it("두 변에 같은 배율이 걸려 비율이 유지된다", () => {
    const s = scaleFor(3000, 2000, 1200);
    expect(Math.round(3000 * s)).toBe(1200);
    expect(Math.round(2000 * s)).toBe(800);
  });

  // 보관(1200)과 OCR(1600)이 같은 함수를 쓴다. 기준이 달라도 규칙은 같아야 한다.
  it("maxEdge 가 달라도 긴 변이 그 값에 맞는다", () => {
    expect(Math.round(4000 * scaleFor(4000, 3000, 1600))).toBe(1600);
    expect(Math.round(4000 * scaleFor(4000, 3000, 1200))).toBe(1200);
  });
});
