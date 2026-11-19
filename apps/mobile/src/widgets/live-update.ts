import { requireOptionalNativeModule } from 'expo'

type CrewUpdate = { title: string; text: string; chip: string | null; url: string }

type LiveUpdateModule = {
    show(update: CrewUpdate, channelName: string): Promise<void>
    isShowing(): Promise<boolean>
    end(): Promise<void>
}

// Only in an Android binary built with it: null on iOS and in an older build.
export const LiveUpdate = requireOptionalNativeModule<LiveUpdateModule>('LiveUpdate')
