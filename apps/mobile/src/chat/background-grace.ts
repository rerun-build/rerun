import { requireOptionalNativeModule } from 'expo'

type BackgroundGraceModule = {
    begin(): Promise<number>
    end(): Promise<boolean>
}

// Only in a binary built with it: null elsewhere, where the stream is let go at once.
export const BackgroundGrace = requireOptionalNativeModule<BackgroundGraceModule>('BackgroundGrace')
