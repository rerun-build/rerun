import { requireOptionalNativeModule } from 'expo'

type BackgroundGraceModule = {
    begin(): Promise<number>
    end(): Promise<boolean>
}

export const BackgroundGrace = requireOptionalNativeModule<BackgroundGraceModule>('BackgroundGrace')
