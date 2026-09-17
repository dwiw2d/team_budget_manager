/** canvas 로 사진을 줄이는 공용 코드. OCR 전송(1600px·0.85)과 보관(1200px·0.7)이 함께 쓴다. */

/** 보관용 크기. 장당 약 200KB 를 목표로 한 값이다. */
export const STORAGE_MAX_EDGE = 1200;
export const STORAGE_QUALITY = 0.7;

/** 긴 변을 maxEdge 에 맞추는 배율. 원본이 더 작으면 확대하지 않는다(1). 순수 함수. */
export function scaleFor(width: number, height: number, maxEdge: number): number {
  return Math.min(1, maxEdge / Math.max(width, height));
}

/** "data:image/jpeg;base64,AAA" → "AAA". 구분자가 없으면 그대로 돌려준다. */
export function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 열 수 없습니다"));
    };
    img.src = url;
  });
}

/** 긴 변을 maxEdge 에 맞춰 그린 canvas. 아래 두 함수가 형식만 달리해 내보낸다. */
async function drawScaled(file: File, maxEdge: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(file);
  const scale = scaleFor(img.naturalWidth, img.naturalHeight, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** canvas 로 긴 변 maxEdge, JPEG quality 로 줄여 data URL 로 만든다. OCR 전송용. */
export async function resizeToDataUrl(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const canvas = await drawScaled(file, maxEdge);
  return {
    dataUrl: canvas.toDataURL("image/jpeg", quality),
    width: canvas.width,
    height: canvas.height,
  };
}

/** 같은 축소를 Blob 으로 낸다. 저장소 업로드용. canvas.toBlob 이 콜백이라 Promise 로 감싼다. */
export async function resizeToBlob(
  file: File,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = await drawScaled(file, maxEdge);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("이미지를 변환할 수 없습니다");
  return { blob, width: canvas.width, height: canvas.height };
}
