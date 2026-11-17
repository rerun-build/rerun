import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_TOOL_DEFS, ACCOUNT_TOOL_NAMES } from './account-tools'

// The server advertises one static list and dispatches through four chained switches. Nothing
// else ties them together, so a tool declared with no case answers "Unknown tool" to a model that
// trusted tools/list, and a name declared twice silently shadows a handler.

const advertisedNames: string[] = ACCOUNT_TOOL_NAMES

const handledNames = ['mcp-account.service.ts', 'mcp-vault.service.ts', 'mcp-shares.service.ts', 'mcp-templates.service.ts'].flatMap(file =>
    [...readFileSync(path.resolve(import.meta.dirname, '../../app/api/_services', file), 'utf8').matchAll(/case '([a-z_]+)':/g)].map(match => match[1]),
)

describe('account tool defs', () => {
    it('advertises every name once', () => {
        expect([...new Set(ACCOUNT_TOOL_NAMES)]).toHaveLength(ACCOUNT_TOOL_NAMES.length)
    })

    it('has a handler for every advertised tool', () => {
        expect(ACCOUNT_TOOL_NAMES.filter(name => !handledNames.includes(name))).toEqual([])
    })

    it('advertises every handled tool', () => {
        expect(handledNames.filter(name => !advertisedNames.includes(name))).toEqual([])
    })

    it('describes what each tool does, for the calling model', () => {
        expect(ACCOUNT_TOOL_DEFS.filter(tool => tool.description.length < 40)).toEqual([])
    })

    // A handler asking for an agreement the schema never mentions is a call that can only fail
    // once, be read as a refusal, and be abandoned.
    it('advertises the confirm flag on every tool that asks for one', () => {
        const gated = [
            'delete_agent',
            'delete_skill',
            'delete_schedule',
            'delete_trigger',
            'detach_connector',
            'delete_template',
            'remove_template_agent',
            'create_agent_share',
            'revoke_agent_share',
            'delete_vault_entry',
        ]
        const missing = gated.filter(name => {
            const tool = ACCOUNT_TOOL_DEFS.find(candidate => candidate.name === name) as { inputSchema: { properties: Record<string, { type?: string }> } } | undefined
            return tool?.inputSchema.properties.confirm?.type !== 'boolean'
        })
        expect(missing).toEqual([])
    })

    it('advertises paginated skill reference reads', () => {
        const read = ACCOUNT_TOOL_DEFS.find(tool => tool.name === 'read_skill_file') as {
            description: string
            inputSchema: { properties: { offset?: { type: string; minimum?: number } } }
        }
        expect(read.inputSchema.properties.offset).toMatchObject({ type: 'integer', minimum: 0 })
        expect(read.description).toContain('nextOffset')
    })
})
