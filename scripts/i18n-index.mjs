#!/usr/bin/env node
// `pnpm i18n:index`: rewrites messages/<locale>/index.ts from the namespace files present, so a new
// namespace is typed at once. `pnpm i18n:translate` does it too; this one spends nothing.
import { writeIndexes } from './i18n/catalog.mjs'

writeIndexes()
console.log('i18n: indexes written.')
