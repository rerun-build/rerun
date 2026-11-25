import { ATLAS, NOVA } from '@/components/onboarding/panels/cast'
import { panelCatalog } from '@/components/onboarding/panels/catalog'
import { setConnectorServices } from '@/hooks/useConnectorServices'
import type { InstalledService } from '@/lib/services/types'
import type { UIMessage } from 'ai'
import type { useTranslations } from 'next-intl'

type ShowcaseTranslator = ReturnType<typeof useTranslations<'onboarding.showcase'>>

function installed(slugs: string[]): InstalledService[] {
    return slugs.flatMap(slug => {
        const app = panelCatalog().get(slug)
        return app ? [{ key: slug, slug, name: app.name, icon: app.icon, category: app.category ?? 'other', status: 'active' as const, toolNames: [slug], installedAt: '' }] : []
    })
}

// The chat draws the logo of each app its steps used out of this store, which asks the engine of a
// coworker it does not know: these two exist nowhere else, and have to be there before the first
// message mounts.
setConnectorServices(NOVA.id, installed(['gmail', 'slack']), [])
setConnectorServices(ATLAS.id, installed(['linkedin', 'hubspot', 'gmail']), [])

const said = (id: string, role: UIMessage['role'], text: string): UIMessage => ({ id, role, parts: [{ type: 'text', text }] })

const call = (toolName: string, toolCallId: string, output: string): UIMessage['parts'][number] => ({ type: 'dynamic-tool', toolName, toolCallId, state: 'output-available', input: {}, output })

const table = (name: string, columns: string[], rows: string[][], total: number, tones: Record<string, string>): string =>
    JSON.stringify({
        kind: 'table',
        scope: 'agent',
        table: name,
        columns,
        rows: rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]]))),
        total,
        columnsTruncated: false,
        formats: { [columns[columns.length - 1]]: 'tag' },
        tones,
    })

export function taskMessages(t: ShowcaseTranslator): UIMessage[] {
    const added = t('task.added')
    const columns = [t('task.columns.name'), t('task.columns.company'), t('task.columns.title'), t('task.columns.status')]
    const rows = [
        ['Omar Haddad', 'Gulf Freightways', 'CFO', added],
        ['Leila Nasser', 'Jebel Ali Cargo', 'Group CFO', added],
        ['Rahul Menon', 'Desert Line', 'CFO', added],
        ['Sara Al Mansoori', 'Port Rashid Logistics', 'CFO', added],
    ]
    return [
        said('task-ask', 'user', t('task.ask')),
        {
            id: 'task-answer',
            role: 'assistant',
            parts: [
                call('mcp__linkedin__search_people', 'task-1', 'ok'),
                call('mcp__hubspot__create_contacts', 'task-2', 'ok'),
                call('card_table', 'task-3', table('leads', columns, rows, 30, { [added]: 'green' })),
                { type: 'text', text: t('task.answer') },
            ],
        },
    ]
}

export function routineMessages(t: ShowcaseTranslator): UIMessage[] {
    const ready = t('done.draftReady')
    const needsYou = t('done.needsYou')
    const columns = [t('done.columns.from'), t('done.columns.subject'), t('done.columns.status')]
    const rows = [
        ['Claire, Maison Clair', t('done.subjects.invoice'), ready],
        ['Tom, Northbay', t('done.subjects.renewal'), needsYou],
        ['Ines, Kerio Supply', t('done.subjects.delivery'), ready],
        ['Sam, Portside', t('done.subjects.call'), ready],
    ]
    return [
        said('routine-fired', 'user', `<scheduled_run schedule="morning-inbox" name="${t('done.routine')}">\n${t('done.instructions')}\n</scheduled_run>`),
        {
            id: 'routine-answer',
            role: 'assistant',
            parts: [
                call('mcp__gmail__search_threads', 'routine-1', 'ok'),
                call('mcp__gmail__create_draft', 'routine-2', 'ok'),
                call('mcp__slack__send_message', 'routine-3', 'ok'),
                call('card_table', 'routine-4', table('replies', columns, rows, 9, { [ready]: 'green', [needsYou]: 'orange' })),
                { type: 'text', text: t('done.answer') },
            ],
        },
    ]
}
