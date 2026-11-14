type CodexThread = { threadId: string; connectionId: string; throughMessageId: string }

const threads = new Map<string, CodexThread>()

const keyOf = (agentId: string, sessionId: string) => `${agentId}:${sessionId}`

export function codexThreadToResume(agentId: string, sessionId: string, connectionId: string, lastMessageId: string | undefined): string | undefined {
    const thread = threads.get(keyOf(agentId, sessionId))
    if (!thread || thread.connectionId !== connectionId || thread.throughMessageId !== lastMessageId) return undefined
    return thread.threadId
}

export function rememberCodexThread(agentId: string, sessionId: string, thread: CodexThread): void {
    threads.set(keyOf(agentId, sessionId), thread)
}

export function forgetCodexThread(agentId: string, sessionId: string): void {
    threads.delete(keyOf(agentId, sessionId))
}

export function forgetCodexThreadsOf(connectionId: string): void {
    for (const [key, thread] of threads) if (thread.connectionId === connectionId) threads.delete(key)
}
