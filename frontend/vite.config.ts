import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Keep the repo default in sync with README (8963), but allow local overrides.
      "/api": `http://${process.env.VITE_BACKEND_HOST || "localhost"}:${
        process.env.THAIGL_PORT || process.env.VITE_BACKEND_PORT || "8963"
      }`,
    },
  },
});
