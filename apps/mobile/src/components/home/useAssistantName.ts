import { FOREMAN_DISPLAY_NAME } from '@rerun/contracts'

import { useAuth } from '@/auth/AuthProvider'

// What the workspace calls its Chief of Staff: the name it gave it, else its title.
export function useAssistantName(): string {
    return useAuth().me?.workspace.assistantName ?? FOREMAN_DISPLAY_NAME
}
