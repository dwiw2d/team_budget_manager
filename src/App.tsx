import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { supabase } from "./lib/supabase";
import AddPayment from "./pages/AddPayment";
import Cards from "./pages/Cards";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Payments from "./pages/Payments";
import Settings from "./pages/Settings";

const TABS = [
  ["/", "홈"],
  ["/payments", "내역"],
  ["/cards", "카드"],
  ["/settings", "설정"],
] as const;

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** 로그인 후 공통 레이아웃: 본문 + 하단 탭 4개 + (홈·내역) 결제 추가 플로팅 버튼 */
function Layout() {
  const { pathname } = useLocation();
  const showFab = pathname === "/" || pathname === "/payments";
  return (
    <>
      <main className="mx-auto w-full max-w-md px-4 pb-24 pt-4">
        <Outlet />
      </main>
      {showFab && (
        <Link
          to="/add"
          className="fixed bottom-20 right-4 flex h-14 items-center rounded-full bg-slate-900 px-5 font-semibold text-white shadow-lg"
        >
          ＋ 결제 추가
        </Link>
      )}
      <nav className="fixed inset-x-0 bottom-0 flex h-16 border-t border-slate-200 bg-white">
        {TABS.map(([to, name]) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              `flex flex-1 items-center justify-center text-sm ${
                isActive ? "font-bold text-slate-900" : "text-slate-500"
              }`
            }
          >
            {name}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default function App() {
  // undefined = 세션 확인 전(INITIAL_SESSION 대기)
  const [session, setSession] = useState<Session | null>();
  const online = useOnline();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return <p className="p-4 text-slate-500">불러오는 중…</p>;

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      {!online && (
        <div className="sticky top-0 z-10 bg-red-600 px-4 py-2 text-center text-sm text-white">
          네트워크 연결을 확인하세요
        </div>
      )}
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route element={session ? <Layout /> : <Navigate to="/login" replace />}>
          <Route path="/" element={<Home />} />
          <Route path="/add" element={<AddPayment />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
