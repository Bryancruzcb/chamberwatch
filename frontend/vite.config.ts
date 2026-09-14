/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server and the preview server pass /api to the backend, on port 8080 unless CHAMBERWATCH_API says
// otherwise, for example CHAMBERWATCH_API=http://localhost:18080 when 8080 is taken.
const api = process.env.CHAMBERWATCH_API ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
  test: { include: ['src/**/*.test.ts'] },
})
