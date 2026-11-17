/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: { proxy: { "/admin/api": "http://localhost:8000" } },
  test: { environment: "node" },
});
