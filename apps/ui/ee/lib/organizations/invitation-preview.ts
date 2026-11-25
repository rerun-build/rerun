export const INVITED_WORKSPACE = 'RERUN_INVITED_WORKSPACE'

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

// The email was rendered once, its workspace left to be named.
export function nameInvitation(html: string, workspaceName: string): string {
    const escaped = workspaceName.replace(/[&<>"']/g, character => ENTITIES[character])
    return html.split(INVITED_WORKSPACE).join(escaped)
}
