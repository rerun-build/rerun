#!/usr/bin/env node
// `pnpm i18n:check`: every pack has every key of the English source, carries its placeholders, was
// translated from the source as it reads today, and has no key the source dropped. No network: the
// CI runs it, `pnpm i18n:translate` is what fixes what it reports.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
    flatten,
    hashOf,
    indexFile,
    indexSource,
    MESSAGES_DIR,
    namespaces,
    problemsOf,
    readGlossary,
    readLock,
    readNamespace,
    ROOT,
    SOURCE_LOCALE,
    targetLocales,
} from './i18n/catalog.mjs'

const glossary = readGlossary()
const lock = readLock()
const errors = []
const warnings = []

for (const locale of [SOURCE_LOCALE, ...targetLocales()]) {
    if (!existsSync(indexFile(locale))) errors.push(`${locale}: messages/${locale}/index.ts is missing`)
    else if (readFileSync(indexFile(locale), 'utf8') !== indexSource(locale)) errors.push(`${locale}: messages/${locale}/index.ts is stale, run pnpm i18n:translate`)
}

for (const ns of namespaces(SOURCE_LOCALE)) {
    for (const [key, source] of Object.entries(flatten(readNamespace(SOURCE_LOCALE, ns)))) {
        for (const problem of problemsOf({ key: `${ns}.${key}`, source, translation: source, locale: SOURCE_LOCALE, glossary }).filter(problem => problem.includes('dash'))) warnings.push(`${SOURCE_LOCALE}: ${problem} (kept: English copy is not rewritten by the check)`)
    }
}

for (const locale of targetLocales()) {
    const locked = lock[locale] ?? {}
    for (const ns of namespaces(SOURCE_LOCALE)) {
        const source = flatten(readNamespace(SOURCE_LOCALE, ns))
        const translated = flatten(readNamespace(locale, ns))
        for (const [key, text] of Object.entries(source)) {
            const id = `${ns}.${key}`
            if (translated[key] === undefined) {
                errors.push(`${locale}: ${id} is missing`)
                continue
            }
            if (locked[id] !== hashOf(text)) errors.push(`${locale}: ${id} was translated from an older source`)
            for (const problem of problemsOf({ key: id, source: text, translation: translated[key], locale, glossary })) errors.push(`${locale}: ${problem}`)
        }
        for (const key of Object.keys(translated)) if (source[key] === undefined) errors.push(`${locale}: ${ns}.${key} is not in the English source anymore`)
    }
    for (const ns of namespaces(locale)) if (!namespaces(SOURCE_LOCALE).includes(ns)) errors.push(`${locale}: namespace ${ns} has no English source`)
    for (const id of Object.keys(locked)) {
        const [ns, ...rest] = id.split('.')
        if (flatten(readNamespace(SOURCE_LOCALE, ns))[rest.join('.')] === undefined) warnings.push(`${locale}: lock entry ${id} has no source, it goes away on the next translate`)
    }
}

const relative = path.relative(ROOT, MESSAGES_DIR)
for (const warning of warnings) console.warn(`warning  ${warning}`)
if (errors.length) {
    for (const error of errors) console.error(`error    ${error}`)
    console.error(`\n${errors.length} problem(s) in ${relative}. Run pnpm i18n:translate, then pnpm i18n:check again.`)
    process.exit(1)
}
console.log(`i18n: ${targetLocales().length} pack(s) in ${relative} match the English source.`)
