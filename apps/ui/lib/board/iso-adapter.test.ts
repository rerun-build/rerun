import { describe, expect, it } from 'vitest'

import { containerFromSpace } from './iso-adapter'
import { UNNAMED_BOX_LABEL } from './types'

const space = { id: 's1', workspace_id: 1, name: null, col_start: 2, row_start: 2, col_end: 9, row_end: 9, created_at: null }

describe('containerFromSpace', () => {
    it('labels a Box that has no name', () => {
        const container = containerFromSpace(space)
        expect(container.label).toBe(UNNAMED_BOX_LABEL)
        expect(container.ariaLabel).toBe(`Box: ${UNNAMED_BOX_LABEL}`)
    })

    it('keeps the name it has', () => {
        const container = containerFromSpace({ ...space, name: 'Acme' })
        expect(container.label).toBe('Acme')
        expect(container.ariaLabel).toBe('Box: Acme')
    })
})
