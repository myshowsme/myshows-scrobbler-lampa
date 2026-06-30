// Build script: minify the hand-written ES5 source into the install artifact.
//
//   myshows.full.js  (source of truth — edit this)
//        │  terser, ecma 5 (ES5-safe: never introduces arrows/let/const)
//        ▼
//   myshows.js       (AUTO-GENERATED — do not edit by hand)
//
// Run: npm run build

import { readFile, writeFile } from 'node:fs/promises'
import { minify } from 'terser'

const SRC = 'myshows.full.js'
const OUT = 'myshows.js'

const banner =
  '/*! AUTO-GENERATED from ' +
  SRC +
  ' — DO NOT EDIT BY HAND. Run `npm run build` after changing the source. */\n'

const source = await readFile(SRC, 'utf8')

const result = await minify(
  { [SRC]: source },
  {
    ecma: 5, // keep output ES5 for old Smart TV / Tizen / WebOS runtimes
    compress: { passes: 2 },
    mangle: true,
    format: {
      preamble: banner,
      comments: false, // strip the source's own comments (the banner is kept via preamble)
    },
  },
)

if (result.error) throw result.error

await writeFile(OUT, result.code + '\n', 'utf8')

const kb = (n) => (n / 1024).toFixed(1) + ' KB'
console.log('built ' + OUT + ': ' + kb(source.length) + ' -> ' + kb(result.code.length))
