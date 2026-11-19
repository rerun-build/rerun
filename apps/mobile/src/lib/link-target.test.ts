import { parseLinkTarget } from './link-target'

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(async () => {}) }))

// The choice is read once per launch: each case starts from a fresh module, as a new launch would.
function freshLaunch(read: () => Promise<string | null>) {
    let loadLinkTarget!: typeof import('./link-target').loadLinkTarget
    let getItemAsync!: jest.Mock
    jest.isolateModules(() => {
        ;({ getItemAsync } = jest.requireMock<{ getItemAsync: jest.Mock }>('expo-secure-store'))
        getItemAsync.mockImplementation(read)
        ;({ loadLinkTarget } = jest.requireActual<typeof import('./link-target')>('./link-target'))
    })
    return { loadLinkTarget, getItemAsync }
}

describe('parseLinkTarget', () => {
    it("opens links in the phone's browser unless Rerun was chosen", () => {
        expect(parseLinkTarget('app')).toBe('app')
        expect(parseLinkTarget('browser')).toBe('browser')
        expect(parseLinkTarget(null)).toBe('browser')
        expect(parseLinkTarget('safari')).toBe('browser')
    })
})

describe('loadLinkTarget', () => {
    it('reads the choice once from the device', async () => {
        const { loadLinkTarget, getItemAsync } = freshLaunch(async () => 'app')
        expect(await loadLinkTarget()).toBe('app')
        expect(await loadLinkTarget()).toBe('app')
        expect(getItemAsync).toHaveBeenCalledTimes(1)
    })

    it("falls back to the phone's browser when the device cannot be read", async () => {
        const { loadLinkTarget } = freshLaunch(async () => {
            throw new Error('locked')
        })
        expect(await loadLinkTarget()).toBe('browser')
    })
})
