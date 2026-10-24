import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom", "@mantine/core", "@mantine/hooks"],
  },
  build: {
    outDir: "dist-renderer",
    emptyOutDir: true,
  },
});
