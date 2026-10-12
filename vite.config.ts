import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// GitHub Pages: 저장소 이름이 base 가 됩니다 (예: /kjhub/). 사용자 페이지(계정.github.io)면 '/'
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/kjhub/',
  build: { outDir: 'dist', sourcemap: false },
});
