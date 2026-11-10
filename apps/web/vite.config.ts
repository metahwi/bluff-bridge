import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 개발 중에는 `vite`(화면)와 `wrangler dev`(서버, 8787)를 따로 띄우고 요청을 넘겨준다.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/ws': { target: 'ws://127.0.0.1:8787', ws: true },
    },
  },
});
