import { requireOptionalNativeModule } from 'expo'

type PushPortraitModule = { clear(): Promise<void> }

// Only in an Android binary built with it: null on iOS and in an older build.
const PushPortrait = requireOptionalNativeModule<PushPortraitModule>('PushPortrait')

export async function clearPushPortraits(): Promise<void> {
    await PushPortrait?.clear()
}
