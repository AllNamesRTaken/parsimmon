import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: './build',
    emptyOutDir: true,
    // sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'src/parsimmon.js'),
      name: 'Parsimmon',
      formats: ["umd", "iife", "es", "cjs"],
      fileName: (format) => `parsimmon.${format}.min.js`
    }
  }
})
