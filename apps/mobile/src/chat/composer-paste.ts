import { NativeModule, requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

declare class ComposerPasteModule extends NativeModule<{ onPasteImages: (event: { uris: string[] }) => void; onHardwareReturn: () => void }> {}

// Only in a binary built with it: elsewhere a pasted image is ignored, as before.
const ComposerPaste = requireOptionalNativeModule<ComposerPasteModule>('ComposerPaste')

// The images pasted into the composer, as JPEG files on the phone.
export function addPasteImagesListener(listener: (uris: string[]) => void): () => void {
    if (!ComposerPaste) return () => {}
    const subscription = ComposerPaste.addListener('onPasteImages', event => listener(event.uris))
    return () => subscription.remove()
}

// Return pressed on a hardware keyboard (an iPad's), Shift left alone: the on-screen keyboard's Return
// and Shift+Return still add a line. Only the iOS module sends it.
export function addHardwareReturnListener(listener: () => void): () => void {
    if (!ComposerPaste || Platform.OS !== 'ios') return () => {}
    const subscription = ComposerPaste.addListener('onHardwareReturn', () => listener())
    return () => subscription.remove()
}
