import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "SW2HW 장부",
        short_name: "SW2HW 장부",
        lang: "ko",
        display: "standalone",
        start_url: ".",
        theme_color: "#0f172a",
        background_color: "#ffffff",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      // 앱 셸만 프리캐시. runtimeCaching 을 두지 않으므로 Supabase 요청은 캐시되지 않는다.
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "supabase/functions/ocr/**/*.test.ts"],
  },
});
