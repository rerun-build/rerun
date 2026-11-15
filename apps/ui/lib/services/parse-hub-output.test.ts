import { describe, expect, it } from 'vitest'
import { parseHubOutput } from './parse-hub-output'

const payload = { kind: 'table', table: 'contacts' }

describe('parseHubOutput', () => {
    it('returns a plain object untouched', () => {
        expect(parseHubOutput(payload)).toEqual(payload)
    })

    it('parses a JSON string', () => {
        expect(parseHubOutput(JSON.stringify(payload))).toEqual(payload)
    })

    it('unwraps the MCP content array the CLI providers produce', () => {
        expect(parseHubOutput([{ type: 'text', text: JSON.stringify(payload) }])).toEqual(payload)
    })

    it('prefers structuredContent when the result carries one', () => {
        expect(parseHubOutput({ structuredContent: payload })).toEqual(payload)
    })

    it('unwraps the json envelope of a persisted tool result', () => {
        expect(parseHubOutput({ type: 'json', value: payload })).toEqual(payload)
    })

    it('unwraps a text envelope holding JSON', () => {
        expect(parseHubOutput({ type: 'text', value: JSON.stringify(payload) })).toEqual(payload)
    })

    it('leaves an object that merely has a type field alone', () => {
        const notAnEnvelope = { type: 'table', rows: [] }
        expect(parseHubOutput(notAnEnvelope)).toEqual(notAnEnvelope)
    })

    it('returns null on a string that is not JSON', () => {
        expect(parseHubOutput('Could not show that table: no such table')).toBeNull()
    })
})
