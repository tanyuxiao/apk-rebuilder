import { defineConfig } from 'vite';

const backendPort = Number.parseInt(process.env.PORT || '3000', 10);

export default defineConfig({
  root: 'public',
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
      '/plugin': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
