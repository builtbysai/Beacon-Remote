import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.REMOTE_API_ORIGIN ?? "http://127.0.0.1:3010",
        ws: true,
      },
    },
  },
});
