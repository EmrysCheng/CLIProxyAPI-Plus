/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output lands inside the Go module so `go:embed all:static` in
// internal/webui picks it up. The dev proxy forwards /panel to a local server.
export default defineConfig({
  plugins: [react()],
  base: '/panel/',
  build: {
    outDir: '../internal/webui/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-antd': ['antd'],
          'vendor-icons': ['@ant-design/icons'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  server: {
    port: 5183,
    proxy: {
      '/panel': {
        target: 'http://127.0.0.1:8317',
        changeOrigin: false,
      },
    },
  },
});
