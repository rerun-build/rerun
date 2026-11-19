import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { IsoGridProps } from '@moldwright/ui/iso-grid'
import { DROP_REFUSAL_MS, DropHint } from '../../../../packages/ui/src/iso-grid/components/DropHint'

const box = { left: 10, top: 20, width: 56, height: 28 }
const html = (reason: string | null, span = 1) => renderToStaticMarkup(createElement(DropHint, { box, span, reason, zIndex: 5 }))

describe('DropHint', () => {
    it('lights the cell green and says nothing when the drop is allowed', () => {
        const out = html(null)
        expect(out).toContain('data-drop-hint="ok"')
        expect(out).toContain('#2dd4a3')
        expect(out).not.toContain('role="status"')
    })

    it('lights the cell red with the reason on one line when the drop is refused', () => {
        for (const reason of ['another object is here', 'outside every box']) {
            const out = html(reason)
            expect(out).toContain('data-drop-hint="refused"')
            expect(out).toContain('#ef4444')
            expect(out).toMatch(new RegExp(`role="status"[^>]*>${reason}<`))
        }
    })

    it('keeps the refusal on screen two seconds', () => {
        expect(DROP_REFUSAL_MS).toBe(2000)
    })

    it('draws a span of 2 twice the size of a span of 1', () => {
        const pts = (s: number) => /points="([^"]+)"/.exec(html(null, s))![1].split(' ').map(p => p.split(',').map(Number))
        const [a, b] = [pts(1), pts(2)]
        a.forEach((p, i) => {
            expect(b[i][0]).toBe(p[0] * 2)
            expect(b[i][1]).toBe(p[1] * 2)
        })
    })

    it('accepts canDropTile on the board props', () => {
        const canDropTile: (id: string, cell: { col: number; row: number }, containerId: string | null) => string | null = () => null
        const props: Pick<IsoGridProps, 'canDropTile'> = { canDropTile }
        expect(props.canDropTile).toBe(canDropTile)
    })
})
