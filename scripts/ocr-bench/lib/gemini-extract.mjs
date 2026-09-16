// 본체는 Edge Function 쪽으로 옮겼다. 벤치 스크립트가 쓰던 이름을 그대로 재수출한다.
// Node 24 는 .ts 를 타입만 벗겨 그대로 import 한다(type stripping).
export * from "../../../supabase/functions/ocr/gemini.ts";
