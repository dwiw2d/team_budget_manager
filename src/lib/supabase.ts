import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("VITE_SUPABASE_URL 과 VITE_SUPABASE_ANON_KEY 환경 변수가 필요합니다");
}

export const supabase = createClient(url, anonKey);
