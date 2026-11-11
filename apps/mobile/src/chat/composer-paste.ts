import { NativeModule, requireOptionalNativeModule } from 'expo'

declare class ComposerPasteModule extends NativeModule<{ onPasteImages: (event: { uris: string[] }) => void }> {}

// Only in a binary built with it: elsewhere a pasted image is ignored, as before.
const ComposerPaste = requireOptionalNativeModule<ComposerPasteModule>('ComposerPaste')

// The images pasted into the composer, as JPEG files on the phone.
export function addPasteImagesListener(listener: (uris: string[]) => void): () => void {
    if (!ComposerPaste) return () => {}
    const subscription = ComposerPaste.addListener('onPasteImages', event => listener(event.uris))
    return () => subscription.remove()
}
