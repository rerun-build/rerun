import type { UIMessage } from 'ai'

// The web's tool-calls lab (apps/ui/app/render/lab/tool-calls/fixtures.ts), for the iOS one.

type ToolKind = 'think' | 'app_list_tools' | 'app_run_tool' | 'gmail_search' | 'gmail_send' | 'slack_post' | 'hubspot_update' | 'notion_read' | 'shell_exec' | 'fs_read' | 'fs_write' | 'web_search' | 'web_fetch'

const TOOLS: Record<Exclude<ToolKind, 'think'>, { name: string; arg: string; details: string[]; inputs?: Record<string, unknown>[] }> = {
    app_list_tools: { name: 'linkedin_pro_list_tools', arg: 'scope', details: ['sales_navigator'] },
    app_run_tool: {
        name: 'linkedin_pro_run_tool',
        arg: 'tool',
        details: [],
        inputs: [
            { tool: 'sales_nav_search_people', arguments: { keyword: 'CTO', geography: ['Paris'] } },
            { tool: 'linkedin_pro_sales_nav_create_list', arguments: { name: 'CTOs in Paris', type: 'lead' } },
            { tool: 'sales_nav_inmail_balance', arguments: {} },
        ],
    },
    gmail_search: { name: 'mcp__gmail__search_emails', arg: 'query', details: ['from:lea@atelier-nord.fr newer_than:30d', 'subject:"quote" has:attachment', 'to:hello@pixel-co.fr'] },
    gmail_send: { name: 'mcp__gmail__send_email', arg: 'preview', details: ['To lea@atelier-nord.fr, "Quick question about your last launch"', 'To hello@pixel-co.fr, "Saw your Webflow rebuild"'] },
    slack_post: { name: 'mcp__slack__post_message', arg: 'preview', details: ['#sales, "10 cold emails are out"'] },
    hubspot_update: { name: 'mcp__hubspot__update_deal', arg: 'preview', details: ['Atelier Nord, stage: Contacted', 'Pixel & Co, stage: Replied'] },
    notion_read: { name: 'mcp__notion__read_page', arg: 'preview', details: ['Sales playbook / Cold outreach'] },
    shell_exec: { name: 'shell_exec', arg: 'command', details: ['pnpm export --table leads --format csv', 'jq ".[] | select(.team < 10)" leads.json', 'wc -l exports/leads.csv'] },
    fs_read: { name: 'fs_read', arg: 'path', details: ['exports/leads.csv', 'templates/cold-email.md'] },
    fs_write: { name: 'fs_write', arg: 'path', details: ['drafts/atelier-nord.md', 'reports/2026-10-03-outreach.md'] },
    web_search: { name: 'web_search', arg: 'query', details: ['web agencies Lyon contact email', 'Atelier Nord Lyon latest project'] },
    web_fetch: { name: 'web_fetch', arg: 'url', details: ['atelier-nord.fr/contact', 'pixel-co.fr/about'] },
}

const THOUGHTS = ['The small agencies answer faster, start with those.', 'Two of them share a contact address, keep only one.']

type Part = UIMessage['parts'][number]

function partOf(id: string, kind: ToolKind, i: number, state: 'done' | 'error' | 'running'): Part {
    if (kind === 'think') return { type: 'reasoning', text: THOUGHTS[i % THOUGHTS.length], state: state === 'running' ? 'streaming' : 'done' } as Part
    const tool = TOOLS[kind]
    const input = tool.inputs ? tool.inputs[i % tool.inputs.length] : { [tool.arg]: tool.details[i % tool.details.length] }
    const base = { type: 'dynamic-tool', toolName: tool.name, toolCallId: `${id}-${i}`, input }
    if (state === 'running') return { ...base, state: 'input-available' } as Part
    if (state === 'error') return { ...base, state: 'output-error', errorText: '429 Too Many Requests, retry in 30s' } as Part
    return { ...base, state: 'output-available', output: 'Done' } as Part
}

/** A coworker's turn: its steps, then the answer once they are all done. */
export function stepsMessage(id: string, kinds: ToolKind[], { failing = [], running = false }: { failing?: number[]; running?: boolean } = {}): UIMessage {
    const parts = kinds.map((kind, i) => partOf(id, kind, i, running && i === kinds.length - 1 ? 'running' : failing.includes(i) ? 'error' : 'done'))
    const answer: Part = { type: 'text', text: 'Ten cold emails are out, the three agencies that replied are flagged in HubSpot.' } as Part
    return { id, role: 'assistant', parts: running ? parts : [...parts, answer] } as UIMessage
}

const LOOP: ToolKind[] = ['think', 'gmail_search', 'gmail_search', 'shell_exec', 'fs_read', 'think', 'web_search', 'web_fetch', 'shell_exec', 'shell_exec', 'hubspot_update', 'fs_write']

export const STEP_SCENARIOS: Record<string, { label: string; kinds: ToolKind[]; failing?: number[] }> = {
    two: { label: '2 steps', kinds: ['think', 'web_search'] },
    directory: { label: 'Tools run from an app directory', kinds: ['app_list_tools', 'app_run_tool', 'app_run_tool', 'app_run_tool'] },
    six: { label: '6 steps', kinds: ['think', 'gmail_search', 'notion_read', 'shell_exec', 'think', 'gmail_send'] },
    long: { label: '73 steps', kinds: [...Array.from({ length: 70 }, (_, i) => LOOP[i % LOOP.length]), 'gmail_send', 'slack_post', 'think'] },
    error: { label: 'One failed', kinds: ['think', 'gmail_search', 'web_search', 'web_fetch', 'hubspot_update', 'shell_exec', 'gmail_send', 'think', 'slack_post'], failing: [4] },
}

export const LIVE_STEPS: ToolKind[] = ['think', 'gmail_search', 'gmail_search', 'notion_read', 'shell_exec', 'fs_read', 'think', 'web_search', 'web_fetch', 'hubspot_update', 'fs_write', 'gmail_send', 'slack_post']
