import { transformSync } from '@babel/core'
import { defineConfig, type Plugin } from 'vitest/config'

const BANNER =
  '/*! MyShows scrobbler plugin for Lampa — AUTO-GENERATED from src/ by pnpm build. Do not edit by hand. */'

// The crux of the whole experiment: Vite/esbuild/Rolldown cannot emit ES5
// (their floor is ES2015). Split of labor:
//
//   Vite bundles TS modules -> single ESNext IIFE
//   this plugin  -> Babel preset-env downlevels the FINAL chunk to ES5 syntax
//   Vite built-in Terser (minify:'terser', ecma:5) -> minifies
//
// Terser needs NO plugin — it ships with Vite. Only the ES5 syntax step is
// custom, because no first-party Vite plugin fits a single-file IIFE lib
// (@vitejs/plugin-legacy targets multi-chunk HTML apps, not libraries).
//
// preset-env with useBuiltIns:'false' (default) transforms ONLY syntax — it
// never injects polyfills, so fetch / Promise / Object.assign / Array.find
// survive, matching Lampa's real baseline (ES5 syntax + ES2015 built-ins).
function babelDownlevelToEs5(): Plugin {
  return {
    name: 'babel-downlevel-es5',
    apply: 'build',
    enforce: 'post', // run after bundling, before Vite's terser minify
    renderChunk(code) {
      const result = transformSync(code, {
        babelrc: false,
        configFile: false,
        presets: [['@babel/preset-env', { targets: { ie: '11' }, modules: false }]],
        // All our iterables are arrays/arguments — compile spread & for-of to
        // plain index loops instead of Symbol.iterator helpers, so the artifact
        // stays lean and never depends on Symbol (absent on the oldest TVs).
        assumptions: { iterableIsArray: true },
      })
      return result?.code ? { code: result.code, map: null } : null
    },
  }
}

export default defineConfig({
  build: {
    target: 'esnext', // let Babel own the downleveling, not esbuild/rolldown
    minify: 'terser',
    terserOptions: {
      ecma: 5, // keep the minified output ES5 for old Tizen / WebOS runtimes
      compress: { passes: 2 },
      mangle: true,
      // Prepend the banner + a top-level 'use strict' directive. The ESM source
      // is strict, but bundling to a classic-script IIFE drops the directive —
      // re-assert it as the first statement so the whole file runs strict.
      format: { comments: false, preamble: BANNER + '\n"use strict";' },
    },
    lib: {
      entry: 'src/index.ts',
      formats: ['iife'],
      name: 'MyShowsScrobbler',
      fileName: () => 'myshows.js',
    },
    // Emit to dist/ (its own dir — Vite warns against building into the repo
    // root). CI publishes dist/myshows.js + index.html to GitHub Pages.
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [babelDownlevelToEs5()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
