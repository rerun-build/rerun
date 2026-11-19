import { listComputers } from '@/api/computers'
import { useAuth } from '@/auth/AuthProvider'
import type { MentionComputer } from '@/components/chat/mentions'
import { useHub } from '@/data/hub-store'

const NONE: MentionComputer[] = []

// The computers `#` offers in the composer, read once for every conversation on screen.
export function useMentionComputers(): MentionComputer[] {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const { value } = useHub(accessToken && workspaceId !== undefined ? `computers:${workspaceId}` : null, async () => (await listComputers({ accessToken: accessToken!, workspaceId: workspaceId! })).map(({ id, name, handle, status }) => ({ id, name, handle, online: status !== 'offline' })))
    return value ?? NONE
}
