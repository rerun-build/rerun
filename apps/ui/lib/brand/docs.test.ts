import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isSharedDocsPage, rewriteDocs } from './docs'

const NORDLYS = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', supportEmail: 'help@nordlys.example' }
const said = (text: string, brand: Brand = NORDLYS) => rewriteDocs(text, brand)

vi.mock('./urls', () => ({ brandAppUrl: () => 'https://nordlys.rerun.work' }))

describe('a passage of the documentation under a brand', () => {
    it('names the brand, whatever the case, the ending and the edition', () => {
        expect(said('Rerun is an app. **Rerun** does it, with Rerun\'s own hub (RERUN).')).toBe("Nordlys is an app. **Nordlys** does it, with Nordlys's own hub (Nordlys).")
        expect(said('It runs on Rerun Cloud computers.')).toBe('It runs on Nordlys computers.')
        expect(said('On Rerun Cloud, the Vault opens later.')).toBe('The Vault opens later.')
        expect(said('On Rerun Cloud, **Leads** opens.')).toBe('**Leads** opens.')
        expect(said('A Rerun coworker', { ...NORDLYS, name: 'Aurora' })).toBe('An Aurora coworker')
    })

    it('keeps the verb a verb', () => {
        expect(said('You can rerun the task: it reruns at once. Reruns are free of memory.')).toBe('You can re-run the task: it re-runs at once. Re-runs are free of memory.')
    })

    it('keeps the words of a link and drops its address', () => {
        expect(said('See [Vault](/vault#add) and [the docs](https://docs.rerun.build/brain), or [Skills](#skills).')).toBe('See Vault and the docs, or Skills.')
        expect(said('Read [their page](https://www.composio.dev).')).toBe('Read [their page](https://www.composio.dev).')
        expect(said('[![A shot of Rerun](/images/a.webp)](/images/a.webp)\nText.')).toBe('Text.')
        expect(said('Download it from rerun.build/download today. It is light.')).toBe('It is light.')
    })

    it('leads into the app of the brand', () => {
        expect(said('In [the Rerun app](https://app.rerun.build), click the pill.')).toBe('In [the Nordlys app](https://nordlys.rerun.work), click the pill.')
        const code = ['```bash', 'claude mcp add --transport http rerun https://app.rerun.build/api/mcp/account', 'export RERUN_MCP_KEY="rk"', '```'].join('\n')
        expect(said(code)).toBe(['```bash', 'claude mcp add --transport http nordlys https://nordlys.rerun.work/api/mcp/account', 'export MCP_KEY="rk"', '```'].join('\n'))
    })

    it('never sells, nor sends to Rerun', () => {
        for (const line of ['Pro costs \\$29 a month.', 'Pro costs $29 a month.', 'The free trial lasts 5 days.', '| **Plan** | See [billing](/billing#plans) |', '> On a self-hosted install, set the key.', '**Ask.** Click **Request an app**.', 'Get the iPhone app.']) expect(said(line), line).toBe('')
    })

    it('answers help with the support of the organization', () => {
        expect(said('Write to [help@rerun.build](mailto:help@rerun.build) and we restore it.')).toBe('Write to help@nordlys.example and we restore it.')
        expect(said('Publishing is decided by the Rerun team.')).toBe('Publishing is decided by support (help@nordlys.example).')
        expect(said('Ask on [Discord](https://discord.gg/rerun).')).toBe('Ask at help@nordlys.example.')
        const noSupport = { ...NORDLYS, supportEmail: null }
        for (const line of ['Write to help@rerun.build.', 'Ask on Discord.', 'Ask the Rerun team.']) expect(said(line, noSupport), line).not.toMatch(/rerun|discord/i)
    })

    it('keeps or drops a block of code whole', () => {
        expect(said('Before.\n\n```json\n{ "name": "rerun", "ok": true }\n```\n\nAfter.')).toBe('Before.\n\n```json\n{ "name": "nordlys", "ok": true }\n```\n\nAfter.')
        expect(said('Before.\n\n```bash\ndocker pull ghcr.io/rerun-build/rerun-engine\nls\n```\n\nAfter.')).toBe('Before.\n\nAfter.')
        expect(said('One of `rerun`, `anthropic`, `claude`.')).toBe('One of `anthropic`, `claude`.')
    })
})

const DOCS = path.resolve(__dirname, '../../../docs')
const pages = readdirSync(DOCS, { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.mdx') && !file.startsWith('snippets'))
    .map(file => ({ file, url: `https://docs.rerun.build/${file.replace(/\.mdx$/, '')}` }))

describe('the documentation as it is today', () => {
    const shared = pages.filter(page => isSharedDocsPage(page.url))

    it('leaves what Rerun sells, hosts and ships out', () => {
        const urls = shared.map(page => new URL(page.url).pathname)
        expect(urls).toEqual(expect.arrayContaining(['/agents/apps', '/vault', '/brain', '/chief-of-staff', '/concepts', '/teams', '/templates/install', '/api/connect']))
        expect(urls.filter(url => /billing|self-host|selling|expert|quickstart|index|desktop|iphone|computers|create$/.test(url))).toEqual([])
    })

    it.each(shared.map(page => page.file))('%s says nothing of Rerun, and still says something', file => {
        const source = readFileSync(path.join(DOCS, file), 'utf8').replace(/^---[\s\S]*?^---/m, '')
        const text = said(source)
        expect(text.replace(/nordlys\.rerun\.work/g, '').match(/.{0,40}(?:rerun|discord|\$\d).{0,40}/gi) ?? []).toEqual([])
        expect(text.length).toBeGreaterThan(source.length / 3)
    })
})
