import { listComputers } from '@/api/computers'
import { useAuth } from '@/auth/AuthProvider'
import type { MentionComputer } from '@/components/chat/mentions'
import { useHub } from '@/data/hub-store'

// The computers `#` offers in the composer, read once for every conversation on screen. `null` until a
// read has answered.
export function useMentionComputers(): MentionComputer[] | null {
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const { value } = useHub(accessToken && workspaceId !== undefined ? `computers:${workspaceId}` : null, async () => (await listComputers({ accessToken: accessToken!, workspaceId: workspaceId! })).map(({ id, name, handle, status }) => ({ id, name, handle, online: status !== 'offline' })))
    return value
}
