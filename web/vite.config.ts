/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { mockApi } from "./mock";

const mock = process.env.MOCK === "1";

export default defineConfig({
  base: "/admin/",
  plugins: [react(), ...(mock ? [mockApi()] : [])],
  server: mock ? {} : { proxy: { "/admin/api": "http://localhost:8000" } },
  test: { environment: "node" },
});
