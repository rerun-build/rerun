import { RERUN_BRAND } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { mcpClientSnippets, mcpServerName } from './connect'

const NORDLYS = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys & Co' }
const URL = 'https://agents.nordlys.no/api/mcp/account'

describe('the name a client lists the account server under', () => {
    it('is rerun for Rerun, and the brand’s own under an organization', () => {
        expect(mcpServerName(RERUN_BRAND)).toBe('rerun')
        expect(mcpServerName(NORDLYS)).toBe('nordlys-co')
        expect(mcpServerName({ ...NORDLYS, name: '北極光' })).toBe('workspace')
    })

    it('is what every snippet a person pastes says, Rerun’s unless told otherwise', () => {
        const pasted = (name?: string) => (['claude-code', 'chatgpt', 'cursor', 'rerun'] as const).flatMap(client => mcpClientSnippets(client, URL, 'rk_1', name).map(snippet => snippet.value)).join('\n')
        expect(pasted()).toContain('claude mcp add --transport http rerun ')
        expect(pasted()).toContain('RERUN_MCP_KEY')
        expect(pasted('nordlys-co')).not.toMatch(/rerun/i)
        expect(pasted('nordlys-co')).toContain('codex mcp add nordlys-co --url')
        expect(pasted('nordlys-co')).toContain('export NORDLYS_CO_MCP_KEY="rk_1"')
    })
})
