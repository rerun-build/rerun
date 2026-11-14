import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-catalog-'))

const { describe, expect, it } = await import('vitest')
const { toolCatalog } = await import('./catalog.js')

describe('tool catalog', () => {
    it('introspects the cards family', () => {
        const cards = toolCatalog().find(f => f.family === 'cards')
        expect(cards?.tools.map(t => t.name).sort()).toEqual(['card_file', 'card_table', 'table_view_delete', 'table_view_save'])
    })
})
