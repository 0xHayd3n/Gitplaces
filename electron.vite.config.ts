import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('electron/main.ts'),
          'mcp-server': resolve('electron/mcp-server.ts'),
        },
        external: ['esbuild'],   // native-binary pkg — never bundle, always require at runtime
        output: {
          entryFileNames: '[name].js',
          format: 'cjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve('electron/preload.ts')
      },
      rollupOptions: {
        output: {
          entryFileNames: 'index.js'
        }
      }
    }
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: resolve('src/index.html'),
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'markdown':     ['react-markdown', 'remark-gfm', 'remark-emoji', 'rehype-raw', 'rehype-sanitize'],
            'pdfjs':        ['pdfjs-dist'],
            'icons':        ['lucide-react'],
            // react-icons intentionally NOT split — migrating off it in Phase 4
          },
        },
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src')
      }
    },
    plugins: [
      react(),
      Icons({ compiler: 'jsx', jsx: 'react' }),
    ]
  }
})
