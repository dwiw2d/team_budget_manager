import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import StartupGate from "./StartupGate";
import "./index.css";

// 배포가 겹치면 옛 탭이 사라진 해시 파일을 요청해 화면이 통째로 죽는다. 그때는 새로 받는다.
window.addEventListener("vite:preloadError", () => window.location.reload());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StartupGate>
      <App />
    </StartupGate>
  </StrictMode>,
);
