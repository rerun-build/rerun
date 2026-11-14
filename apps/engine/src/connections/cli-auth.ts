import type { Provider } from '@rerun/contracts'
import { acquireClaudeLease, ensureFreshClaudeToken } from './claude-token.js'
import { ensureCodexAuth } from './codex-auth.js'
import type { LoadedConnection } from './types.js'

export async function ensureCliAuth(provider: Provider, connection: LoadedConnection | null): Promise<() => void> {
    if (provider === 'claude') {
        await ensureFreshClaudeToken(connection)
        return acquireClaudeLease(connection)
    }
    if (provider === 'codex') await ensureCodexAuth(connection)
    return () => {}
}
