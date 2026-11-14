import { Constants, type Database } from '@rerun/db/types'
import { selectAll } from '@rerun/db/helpers'
import { captureTemplateCard } from '../lib/templates/card-render'
import { createServiceRoleClient } from '../supabase/serviceRole'

const apply = process.argv.includes('--apply')
const missingOnly = process.argv.includes('--missing')
const allStatuses = process.argv.includes('--all-statuses')
const slugs = listArg('slug')
const statuses = (listArg('status') ?? ['published', 'unlisted']).map(toStatus)
const concurrency = Number(flagArg('concurrency') ?? 3)

const TEMPLATE_COLUMNS = ['slug', 'title', 'status', 'agent_count', 'card_image_dark_url', 'card_image_light_url'] as const

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
const shotUrl = process.env.RERUN_SHOT_URL ?? 'https://shot.rerun.build'

const supabase = createServiceRoleClient()

const filter = slugs ? { slug: slugs } : allStatuses ? {} : { status: statuses }

const { data: rows, error: readError } = await selectAll(supabase, 'templates', TEMPLATE_COLUMNS, filter, { column: 'slug', ascending: true })
if (readError || !rows) throw new Error(readError?.message ?? 'Failed to read the templates.')

const withBoard = rows.filter(row => (row.agent_count ?? 0) > 0)
const targets = missingOnly ? withBoard.filter(row => !row.card_image_dark_url || !row.card_image_light_url) : withBoard

console.log(`Supabase : ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
console.log(`App      : ${appUrl || '(unset)'}`)
console.log(`Shot     : ${shotUrl}\n`)

console.log(`${targets.length} template(s) to capture${apply ? '' : ' (dry run, pass --apply)'}\n`)
for (const target of targets) {
    const pair = [target.card_image_dark_url && 'dark', target.card_image_light_url && 'light'].filter(Boolean)
    console.log(`  ${target.slug.padEnd(44)} ${target.status.padEnd(10)} ${pair.length === 0 ? 'aucune capture' : `déjà ${pair.join(' + ')}`}`)
}

if (!apply) {
    const skipped = rows.length - targets.length
    console.log(`\nNothing captured. ${skipped} row(s) skipped for having no captured agent${missingOnly ? ' or a complete pair' : ''}.`)
    process.exit(0)
}

if (LOCAL_HOST.test(appUrl) && !LOCAL_HOST.test(shotUrl)) {
    throw new Error(`The app is ${appUrl}, which only a local Rerun Shot can reach. Set RERUN_SHOT_URL=http://localhost:4600 and run \`pnpm dev\` in rerun-shot.`)
}

console.log('')
const failures: string[] = []
await mapWithConcurrency(targets, concurrency, async target => {
    const label = target.slug.padEnd(44)
    try {
        const { urls } = await captureTemplateCard(target.slug)
        console.log(`  ok    ${label} ${urls.dark ?? '—'}`)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failures.push(target.slug)
        console.log(`  FAIL  ${label} ${message}`)
    }
})

console.log(`\n${targets.length - failures.length} captured, ${failures.length} failed`)
if (failures.length > 0) console.log(`Retry with --slug=${failures.join(',')}`)
process.exit(failures.length === 0 ? 0 : 1)

function flagArg(name: string): string | undefined {
    return process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1]
}

function listArg(name: string): string[] | undefined {
    const value = flagArg(name)
    return value
        ? value
              .split(',')
              .map(item => item.trim())
              .filter(Boolean)
        : undefined
}

function toStatus(value: string): Database['public']['Enums']['template_status'] {
    const known: readonly string[] = Constants.public.Enums.template_status
    if (!known.includes(value)) throw new Error(`Unknown template status "${value}". Expected one of ${known.join(', ')}.`)
    return value as Database['public']['Enums']['template_status']
}

async function mapWithConcurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
    let next = 0

    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) await run(items[next++])
        }),
    )
}
