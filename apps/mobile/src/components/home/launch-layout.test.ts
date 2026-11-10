import { AVATAR, COWORKER_ROW_HEIGHT, HOME_GUTTER } from '@/components/home/CoworkerRow'
import { SKELETON, SKELETON_ROWS, skeletonBarWidths } from '@/components/home/HomeSkeleton'
import { SIDEBAR } from '@/components/layout/split'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { palette, radius, spacing } from '@/theme/tokens'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LAUNCH_LAYOUT } = require('../../../plugins/with-home-launch-screen')
const appJson = require('../../../app.json')

describe('native launch screen', () => {
    it('starts the rows where the Home starts its list, under the header', () => {
        expect(LAUNCH_LAYOUT.listTop).toBe(spacing.sm + GLASS_BUTTON_SIZE + spacing.xl)
    })

    it('narrows the rows to the sidebar of a regular-width screen', () => {
        expect(LAUNCH_LAYOUT.sidebar).toEqual(SIDEBAR)
    })

    it('paints the background expo-splash-screen is given', () => {
        const splash = appJson.expo.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')[1]
        expect(splash).toEqual({ backgroundColor: LAUNCH_LAYOUT.background.light, dark: { backgroundColor: LAUNCH_LAYOUT.background.dark } })
    })

    it('draws the skeleton rows of HomeSkeleton', () => {
        expect(LAUNCH_LAYOUT).toMatchObject({
            background: { light: palette.light.background, dark: palette.dark.background },
            muted: { light: palette.light.muted, dark: palette.dark.muted },
            rows: SKELETON_ROWS,
            rowHeight: COWORKER_ROW_HEIGHT,
            avatar: { left: HOME_GUTTER, top: SKELETON.avatarTop, size: AVATAR, radius: radius.md },
            column: { left: SKELETON.textLeft, right: HOME_GUTTER },
            name: { top: SKELETON.nameTop, height: SKELETON.nameHeight },
            status: { top: SKELETON.statusTop, height: SKELETON.statusHeight },
            barRadius: radius.sm,
        })
        for (let index = 0; index < SKELETON_ROWS; index++) expect(LAUNCH_LAYOUT.barWidths(index)).toEqual(skeletonBarWidths(index))
    })
})
