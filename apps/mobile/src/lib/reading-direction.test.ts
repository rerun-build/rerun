type ReadingDirection = typeof import('./reading-direction')

function loadIn(isRTL: boolean): ReadingDirection {
    let loaded: ReadingDirection | undefined
    jest.isolateModules(() => {
        const { I18nManager } = jest.requireActual<typeof import('react-native')>('react-native')
        jest.replaceProperty(I18nManager, 'isRTL', isRTL)
        loaded = jest.requireActual<ReadingDirection>('./reading-direction')
    })
    return loaded!
}

const WIDTH = 400
const COUNT = 3
const scrolledTo = (x: number) => ({ contentOffset: { x }, contentSize: { width: WIDTH * COUNT }, layoutMeasurement: { width: WIDTH } })

describe('reading direction', () => {
    afterEach(() => jest.restoreAllMocks())

    it('counts the pages from the left in a left-to-right app', () => {
        const { READING_SIGN, offsetFromStart, offsetOfPage } = loadIn(false)
        expect(READING_SIGN).toBe(1)
        expect([0, 1, 2].map(page => offsetOfPage(page, WIDTH, COUNT))).toEqual([0, 400, 800])
        expect(offsetFromStart(scrolledTo(400)) / WIDTH).toBe(1)
        expect(offsetFromStart(scrolledTo(0)) / WIDTH).toBe(0)
    })

    it('counts them from the right in a right-to-left app', () => {
        const { READING_SIGN, offsetFromStart, offsetOfPage } = loadIn(true)
        expect(READING_SIGN).toBe(-1)
        expect([0, 1, 2].map(page => offsetOfPage(page, WIDTH, COUNT))).toEqual([800, 400, 0])
        expect(offsetFromStart(scrolledTo(0)) / WIDTH).toBe(2)
    })

    it('reads back the page it scrolled to, in both', () => {
        for (const isRTL of [false, true]) {
            const { offsetFromStart, offsetOfPage } = loadIn(isRTL)
            for (const page of [0, 1, 2]) expect(offsetFromStart(scrolledTo(offsetOfPage(page, WIDTH, COUNT))) / WIDTH).toBe(page)
        }
    })
})
