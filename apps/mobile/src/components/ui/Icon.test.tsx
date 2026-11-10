import { ICONS } from '@rerun/cloud-mobile/icons'
import { render, screen } from '@testing-library/react-native'

import { ICONS as SELF_HOSTED_ICONS } from '@/cloud-oss/icons'
import { Icon } from '@/components/ui/Icon'
import type { IconSet } from '@/components/ui/icon-glyph'
import { ICON_NAMES } from '@/components/ui/icon-names'

const BANNED = /sparkle|^bot$|^plug/

function checkSet(set: IconSet) {
    expect(Object.keys(set).sort()).toEqual([...ICON_NAMES].sort())
    for (const name of ICON_NAMES) {
        const glyph = set[name]
        expect(glyph.box).toBeGreaterThan(0)
        expect(glyph.shapes.length).toBeGreaterThan(0)
        if (name.endsWith('-fill')) expect(glyph.shapes.some(shape => shape[2].includes('f'))).toBe(true)
    }
}

describe('Icon', () => {
    it('draws every name in the set the build ships and in the self-hosted twin', () => {
        checkSet(ICONS)
        checkSet(SELF_HOSTED_ICONS)
    })

    it('never ships a banned glyph', () => {
        expect(ICON_NAMES.filter(name => BANNED.test(name))).toEqual([])
    })

    it('renders each name as an image VoiceOver and TalkBack can read', async () => {
        for (const name of ICON_NAMES) {
            const { unmount } = await render(<Icon name={name} color="#000000" accessibilityLabel={name} />)
            expect(screen.getByLabelText(name)).toBeTruthy()
            await unmount()
        }
    })

    it('punches the secondary strokes of a solid glyph through its fill', async () => {
        const glyph = ICONS['circle-check-fill']
        expect(glyph.shapes.some(shape => shape[2].endsWith('x'))).toBe(true)
        const { toJSON } = await render(<Icon name="circle-check-fill" color="#16a34a" />)
        expect(JSON.stringify(toJSON())).toMatch(/mask/i)
    })

    it('stays out of the accessibility tree without a label', async () => {
        await render(<Icon name="x" color="#000000" />)
        expect(screen.queryByRole('image')).toBeNull()
    })
})
