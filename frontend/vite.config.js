import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  server: {
    port: 80,

    allowedHosts: ["metube.nds"],

    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },

      "/hls": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/thumbnails": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
