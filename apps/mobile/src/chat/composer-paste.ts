import { NativeModule, requireOptionalNativeModule } from 'expo'

declare class ComposerPasteModule extends NativeModule<{ onPasteImages: (event: { uris: string[] }) => void }> {}

const ComposerPaste = requireOptionalNativeModule<ComposerPasteModule>('ComposerPaste')

export function addPasteImagesListener(listener: (uris: string[]) => void): () => void {
    if (!ComposerPaste) return () => {}
    const subscription = ComposerPaste.addListener('onPasteImages', event => listener(event.uris))
    return () => subscription.remove()
}
