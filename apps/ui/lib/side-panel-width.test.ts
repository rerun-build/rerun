import { describe, expect, it } from 'vitest'

import {
    SIDE_PANEL_DEFAULT_WIDTH,
    SIDE_PANEL_MIN_WIDTH,
    clampSidePanelWidth,
    getSidePanelMaxWidth,
    parseSidePanelWidth,
} from './side-panel-width'
import { DETAILS_COLUMN_WIDTH } from './workspace-view'

describe('side panel width', () => {
    it('caps its desktop maximum at 800px or 60 percent of the viewport', () => {
        expect(getSidePanelMaxWidth(1440)).toBe(800)
        expect(getSidePanelMaxWidth(1000)).toBe(600)
        expect(getSidePanelMaxWidth(500)).toBe(SIDE_PANEL_MIN_WIDTH)
    })

    it('clamps widths to the supported desktop range', () => {
        expect(clampSidePanelWidth(320, 1440)).toBe(SIDE_PANEL_MIN_WIDTH)
        expect(clampSidePanelWidth(640, 1440)).toBe(640)
        expect(clampSidePanelWidth(1800, 1000)).toBe(600)
    })

    it('falls back to the default for missing or invalid stored values', () => {
        expect(parseSidePanelWidth(null, 1440)).toBe(SIDE_PANEL_DEFAULT_WIDTH)
        expect(parseSidePanelWidth('', 1440)).toBe(SIDE_PANEL_DEFAULT_WIDTH)
        expect(parseSidePanelWidth('not-a-number', 1440)).toBe(SIDE_PANEL_DEFAULT_WIDTH)
    })

    it('restores valid values and clamps stale out-of-range values', () => {
        expect(parseSidePanelWidth('720', 1440)).toBe(720)
        expect(parseSidePanelWidth('200', 1440)).toBe(SIDE_PANEL_MIN_WIDTH)
        expect(parseSidePanelWidth('2000', 1000)).toBe(600)
    })

    it('bounds another panel by its own configuration, the board panel keeping its own', () => {
        expect(clampSidePanelWidth(200, 1440, DETAILS_COLUMN_WIDTH)).toBe(320)
        expect(clampSidePanelWidth(900, 1440, DETAILS_COLUMN_WIDTH)).toBe(648)
        expect(getSidePanelMaxWidth(1280, DETAILS_COLUMN_WIDTH)).toBe(576)
        expect(parseSidePanelWidth(null, 1440, DETAILS_COLUMN_WIDTH)).toBe(400)
        expect(parseSidePanelWidth(null, 1440)).toBe(SIDE_PANEL_DEFAULT_WIDTH)
    })
})
