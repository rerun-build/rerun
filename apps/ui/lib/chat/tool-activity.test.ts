import { toolActivityOf } from '@rerun/contracts'
import { describe, expect, it } from 'vitest'

import { englishTranslator } from '@/lib/i18n/english-translator'

const t = englishTranslator('tools')

describe('toolActivityOf', () => {
    it('reads a known tool as what the coworker is doing', () => {
        expect(toolActivityOf('web_search', undefined, t)).toBe('Searching the web')
        expect(toolActivityOf('fs_read', { path: 'notes.md' }, t)).toBe('Reading a file')
        expect(toolActivityOf('team_get_run', undefined, t)).toBe("Reading a coworker's run")
    })

    it('leaves an unknown tool to the caller', () => {
        expect(toolActivityOf('gmail_search_threads', undefined, t)).toBeUndefined()
        expect(toolActivityOf('paid_data', { capability: 'nope' }, t)).toBeUndefined()
    })
})
