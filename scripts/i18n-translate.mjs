#!/usr/bin/env node
// `pnpm i18n:translate [--locale fr] [--ns chat] [--accept] [--dry-run] [--max-usd 20]`
//
// Translates the strings of the English source that are new or changed since the last run (the
// lock keeps a hash of each source string) into every pack, with Claude, then checks each answer:
// same ICU placeholders, an `other` branch, no dash, the glossary kept, not much longer than the
// English. A failed check is sent back once with its reasons; a second failure stops the run.
//
// `--accept` translates nothing: it records the strings a person fixed by hand in a pack as current,
// once they pass the same checks.
import Anthropic from '@anthropic-ai/sdk'
import {
    contextOf,
    flatten,
    hashOf,
    MESSAGES_DIR,
    namespaces,
    problemsOf,
    readGlossary,
    readLock,
    readNamespace,
    SOURCE_LOCALE,
    targetLocales,
    tooLong,
    unflattenLike,
    writeIndexes,
    writeLock,
    writeNamespace,
} from './i18n/catalog.mjs'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const MODEL = 'claude-sonnet-5-5'
const INPUT_USD_PER_TOKEN = 2 / 1_000_000
const OUTPUT_USD_PER_TOKEN = 10 / 1_000_000
const BATCH_SIZE = 60
// Pack files translated at once: a new language is ~160 calls, too long one after the other.
const CONCURRENT_JOBS = 6
const LANGUAGE_NAMES = { fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Brazilian Portuguese', nl: 'Dutch' }

function readArgs(argv) {
    const args = { locales: [], namespaces: [], accept: false, dryRun: false, maxUsd: 20 }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === '--locale') args.locales.push(...argv[++index].split(','))
        else if (arg === '--ns') args.namespaces.push(...argv[++index].split(','))
        else if (arg === '--accept') args.accept = true
        else if (arg === '--dry-run') args.dryRun = true
        else if (arg === '--max-usd') args.maxUsd = Number(argv[++index])
        else throw new Error(`Unknown argument ${arg}`)
    }
    return args
}

const args = readArgs(process.argv.slice(2))
const glossary = readGlossary()
const lock = readLock()
const locales = args.locales.length ? args.locales : targetLocales()
const sourceNamespaces = namespaces(SOURCE_LOCALE).filter(ns => !args.namespaces.length || args.namespaces.includes(ns))

for (const locale of locales) {
    if (!targetLocales().includes(locale)) throw new Error(`${locale} is not in SUPPORTED_LOCALES (packages/i18n/src/locales.ts)`)
    mkdirSync(path.join(MESSAGES_DIR, locale), { recursive: true })
}

// What each pack owes: the keys missing, translated from an older source, or failing a check.
function pendingWork() {
    const work = []
    for (const locale of locales) {
        for (const ns of sourceNamespaces) {
            const tree = readNamespace(SOURCE_LOCALE, ns)
            const source = flatten(tree)
            const translated = flatten(readNamespace(locale, ns))
            const keys = Object.keys(source).filter(key => {
                const id = `${ns}.${key}`
                if (translated[key] === undefined || lock[locale]?.[id] !== hashOf(source[key])) return true
                return problemsOf({ key: id, source: source[key], translation: translated[key], locale, glossary }).length > 0
            })
            if (keys.length) work.push({ locale, ns, tree, source, translated, keys, context: contextOf(tree) })
        }
    }
    return work
}

function systemPrompt(locale) {
    const language = LANGUAGE_NAMES[locale] ?? locale
    const imposed = Object.entries(glossary.translations ?? {})
        .map(([term, byLocale]) => (byLocale[locale] ? `- "${term}" → "${byLocale[locale]}"` : null))
        .filter(Boolean)
    return [
        `You translate the user interface strings of Rerun, a SaaS product where AI coworkers do work for a team, from English to ${language}.`,
        `Tone: ${glossary.tone?.[locale] ?? 'the usual register of SaaS products in that language.'}`,
        `Keep these words exactly as written: ${(glossary.keep ?? []).join(', ')}.`,
        imposed.length ? `Use these translations:\n${imposed.join('\n')}` : '',
        `Rules:\n${(glossary.rules ?? []).map(rule => `- ${rule}`).join('\n')}`,
        'The strings use ICU MessageFormat. Return one translation per key, with the same keys.',
    ]
        .filter(Boolean)
        .join('\n\n')
}

function userPrompt(job, keys, feedback) {
    const entries = keys.map(key => ({ key, english: job.source[key], ...(job.context[key] ? { context: job.context[key] } : {}) }))
    const lines = [`Namespace "${job.ns}". Translate each "english" value.`, JSON.stringify(entries, null, 2)]
    if (feedback.length) lines.push(`Your previous answer failed these checks, fix them:\n${feedback.map(problem => `- ${problem}`).join('\n')}`)
    return lines.join('\n\n')
}

function outputSchema(keys) {
    return {
        type: 'object',
        properties: Object.fromEntries(keys.map(key => [key, { type: 'string' }])),
        required: keys,
        additionalProperties: false,
    }
}

function estimateTokens(text) {
    return Math.ceil(text.length / 3.5)
}

function chunk(list, size) {
    return Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size))
}

// A key the English source dropped leaves the lock with it.
function pruneLock() {
    for (const locale of Object.keys(lock)) {
        for (const id of Object.keys(lock[locale])) {
            const [ns, ...rest] = id.split('.')
            if (flatten(readNamespace(SOURCE_LOCALE, ns))[rest.join('.')] === undefined) delete lock[locale][id]
        }
    }
}

function accept(work) {
    let accepted = 0
    const refused = []
    for (const job of work) {
        for (const key of job.keys) {
            const id = `${job.ns}.${key}`
            const translation = job.translated[key]
            if (translation === undefined) continue
            const problems = problemsOf({ key: id, source: job.source[key], translation, locale: job.locale, glossary })
            if (problems.length) refused.push(...problems.map(problem => `${job.locale}: ${problem}`))
            else {
                lock[job.locale] ??= {}
                lock[job.locale][id] = hashOf(job.source[key])
                accepted += 1
            }
        }
    }
    pruneLock()
    writeLock(lock)
    writeIndexes()
    for (const problem of refused) console.error(`refused  ${problem}`)
    console.log(`Accepted ${accepted} string(s).`)
    if (refused.length) process.exit(1)
}

async function translateBatch(client, job, keys) {
    let feedback = []
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const response = await client.beta.messages.create({
            model: MODEL,
            max_tokens: 16000,
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: outputSchema(keys) } },
            system: systemPrompt(job.locale),
            messages: [{ role: 'user', content: userPrompt(job, keys, feedback) }],
        })
        if (response.stop_reason === 'refusal') throw new Error(`${job.locale}/${job.ns}: the model declined (${response.stop_details?.category ?? 'no category'})`)
        if (response.stop_reason === 'max_tokens') throw new Error(`${job.locale}/${job.ns}: the answer was cut, lower BATCH_SIZE`)
        const text = response.content.find(block => block.type === 'text')?.text ?? ''
        const answer = JSON.parse(text)
        feedback = keys.flatMap(key => {
            const problems = problemsOf({ key, source: job.source[key], translation: answer[key], locale: job.locale, glossary })
            if (!problems.length && tooLong(job.source[key], answer[key])) problems.push(`${key}: too long (${answer[key].length} characters for ${job.source[key].length} in English), say it shorter`)
            return problems
        })
        if (!feedback.length) return answer
        if (attempt === 2) throw new Error(`${job.locale}/${job.ns}: still failing after a retry:\n${feedback.join('\n')}`)
    }
}

const work = pendingWork()
if (!work.length) {
    pruneLock()
    writeLock(lock)
    writeIndexes()
    console.log('Every pack is up to date with the English source.')
    process.exit(0)
}

if (args.accept) accept(work)
else {
    const promptTokens = work.reduce((sum, job) => sum + estimateTokens(systemPrompt(job.locale)) * Math.ceil(job.keys.length / BATCH_SIZE) + estimateTokens(userPrompt(job, job.keys, [])), 0)
    const answerTokens = work.reduce((sum, job) => sum + job.keys.reduce((total, key) => total + estimateTokens(job.source[key]) * 1.6 + 8, 0), 0)
    // Doubled for the retries and the thinking the model does before it answers.
    const estimateUsd = 2 * (promptTokens * INPUT_USD_PER_TOKEN + answerTokens * OUTPUT_USD_PER_TOKEN)
    const total = work.reduce((sum, job) => sum + job.keys.length, 0)
    console.log(`${total} string(s) to translate across ${work.length} pack file(s), about $${estimateUsd.toFixed(2)} (cap $${args.maxUsd}).`)
    for (const job of work) console.log(`  ${job.locale}/${job.ns}: ${job.keys.length}`)
    if (estimateUsd > args.maxUsd) {
        console.error(`Over the cap of $${args.maxUsd}: narrow it with --ns or --locale, or raise --max-usd.`)
        process.exit(1)
    }
    if (args.dryRun) process.exit(0)

    const client = new Anthropic()
    const queue = [...work]
    const translateNext = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) await translateJob(client, job)
    }
    await Promise.all(Array.from({ length: CONCURRENT_JOBS }, translateNext))
    pruneLock()
    writeLock(lock)
    writeIndexes()
    console.log('Done. Run pnpm i18n:check.')
}

async function translateJob(client, job) {
    const translated = { ...job.translated }
    for (const keys of chunk(job.keys, BATCH_SIZE)) Object.assign(translated, await translateBatch(client, job, keys))
    const kept = Object.fromEntries(Object.entries(translated).filter(([key]) => job.source[key] !== undefined))
    writeNamespace(job.locale, job.ns, unflattenLike(job.tree, kept))
    lock[job.locale] ??= {}
    for (const key of job.keys) lock[job.locale][`${job.ns}.${key}`] = hashOf(job.source[key])
    writeLock(lock)
    console.log(`  wrote ${job.locale}/${job.ns}.json`)
}
