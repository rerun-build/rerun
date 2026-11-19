import type { VoiceMessage } from '@moldwright/contracts'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useEffect, useState } from 'react'

import { cachedFile, ownedFileUrl, type FileOwner } from '@/api/files'
import { useAuth } from '@/auth/AuthProvider'

const playableOnIos = (src: string) => !src.toLowerCase().endsWith('.webm')

export type VoicePlayback = {
    readable: boolean
    playable: boolean
    loaded: boolean
    loading: boolean
    playing: boolean
    elapsedMs: number
    progress: number
    toggle: () => void
    seekAt: (ratio: number) => void
}

export function useVoicePlayback(voice: VoiceMessage, owner: FileOwner | null): VoicePlayback {
    const { session, me } = useAuth()
    const caller = session && me ? { accessToken: session.access_token, workspaceId: me.workspace.id } : null
    const player = useAudioPlayer(null, { updateInterval: 100 })
    const status = useAudioPlayerStatus(player)
    const [loaded, setLoaded] = useState(false)
    const [loading, setLoading] = useState(false)
    const readable = playableOnIos(voice.src)
    const playable = Boolean(owner && caller) && readable

    useEffect(() => {
        if (!status.didJustFinish) return
        player.pause()
        void player.seekTo(0)
    }, [status.didJustFinish, player])

    const toggle = async () => {
        if (status.playing) {
            player.pause()
            return
        }
        if (!loaded) {
            if (!owner || !caller) return
            setLoading(true)
            try {
                const uri = await cachedFile(caller, ownedFileUrl(owner, voice.src), voice.src.split('/').pop() ?? 'voice.m4a')
                player.replace({ uri })
                setLoaded(true)
            } catch {
                return
            } finally {
                setLoading(false)
            }
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false })
        player.play()
    }

    const seekAt = (ratio: number) => {
        if (!loaded || voice.durationMs <= 0) return
        void player.seekTo((Math.min(1, Math.max(0, ratio)) * voice.durationMs) / 1000)
    }

    const elapsedMs = loaded ? status.currentTime * 1000 : 0
    return {
        readable,
        playable,
        loaded,
        loading,
        playing: status.playing,
        elapsedMs,
        progress: voice.durationMs > 0 ? Math.min(1, elapsedMs / voice.durationMs) : 0,
        toggle: () => void toggle(),
        seekAt,
    }
}
