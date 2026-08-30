import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  worker: {
    format: "es",
  },
  server: {
    watch: {
      usePolling: true,
      interval: 200,
    },
  },
});
