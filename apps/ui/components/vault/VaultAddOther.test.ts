import { describe, expect, it } from 'vitest'

import { toVariableName } from './VaultAddOther'

describe('toVariableName', () => {
    it('turns what people type into a variable name', () => {
        expect(toVariableName(' stripe live key ')).toBe('STRIPE_LIVE_KEY')
        expect(toVariableName('notion-api.key')).toBe('NOTION_API_KEY')
        expect(toVariableName('__x__')).toBe('X')
    })
})
