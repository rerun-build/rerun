type Listener = (event: { uris: string[] }) => void

const mockNative = { module: null as null | { addListener: jest.Mock<{ remove: jest.Mock }, [string, Listener]> } }

jest.mock('expo', () => ({
    ...jest.requireActual('expo'),
    requireOptionalNativeModule: () => mockNative.module,
}))

function loadListener() {
    let addPasteImagesListener!: typeof import('./composer-paste').addPasteImagesListener
    jest.isolateModules(() => {
        ;({ addPasteImagesListener } = jest.requireActual<typeof import('./composer-paste')>('./composer-paste'))
    })
    return addPasteImagesListener
}

describe('addPasteImagesListener', () => {
    afterEach(() => {
        mockNative.module = null
    })

    it('hands the pasted files to the listener and stops on unsubscribe', () => {
        const remove = jest.fn()
        let emit: Listener = () => {}
        mockNative.module = {
            addListener: jest.fn((_name: string, listener: Listener) => {
                emit = listener
                return { remove }
            }),
        }
        const listener = jest.fn()

        const unsubscribe = loadListener()(listener)
        emit({ uris: ['file:///cache/composer-paste/pasted-1.jpg', 'file:///cache/composer-paste/pasted-2.jpg'] })
        unsubscribe()

        expect(mockNative.module.addListener).toHaveBeenCalledWith('onPasteImages', expect.any(Function))
        expect(listener).toHaveBeenCalledWith(['file:///cache/composer-paste/pasted-1.jpg', 'file:///cache/composer-paste/pasted-2.jpg'])
        expect(remove).toHaveBeenCalledTimes(1)
    })

    it('does nothing in a binary built without the module', () => {
        const listener = jest.fn()

        const unsubscribe = loadListener()(listener)

        expect(() => unsubscribe()).not.toThrow()
        expect(listener).not.toHaveBeenCalled()
    })
})
