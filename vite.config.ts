import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Windows 上原生文件监听偶尔会漏事件，轮询更稳，避免开发时拿到旧模块
    watch: {
      usePolling: true,
      interval: 400,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
