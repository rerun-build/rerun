import { RERUN_BRAND } from '@rerun/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { INVITED_WORKSPACE, nameInvitation } from './invitation-preview'
import { renderInvitationPreview } from './invitation-preview.server'

describe('the preview of an invitation', () => {
    it('is the real email, in the brand, naming the workspace and nobody of the agency', async () => {
        const html = await renderInvitationPreview({ ...RERUN_BRAND, organizationId: 'o1', name: 'Nordlys', appUrl: 'https://nordlys.rerun.work' }, 'en')
        expect(html).toContain('Nordlys')
        expect(html).toContain(INVITED_WORKSPACE)
        const named = nameInvitation(html, 'Delta Immobilier')
        expect(named).toContain('Delta Immobilier')
        expect(named).not.toContain(INVITED_WORKSPACE)
    })

    it('never lets a name write markup', () => {
        expect(nameInvitation(`<p>${INVITED_WORKSPACE}</p>`, `<img src=x onerror="a('b')"> & co`)).toBe('<p>&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt; &amp; co</p>')
    })
})
