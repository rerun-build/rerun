import { beforeEach, describe, expect, it } from 'vitest'
import { codexThreadToResume, forgetCodexThread, forgetCodexThreadsOf, rememberCodexThread } from './codex-threads.js'

const thread = { threadId: 'thread-1', connectionId: 'cnx-a', throughMessageId: 'msg-2' }

describe('codexThreadToResume', () => {
    beforeEach(() => {
        forgetCodexThreadsOf('cnx-a')
        forgetCodexThreadsOf('cnx-b')
        rememberCodexThread('agent', 'session', thread)
    })

    it('resumes the thread while the session ends on the last message it produced', () => {
        expect(codexThreadToResume('agent', 'session', 'cnx-a', 'msg-2')).toBe('thread-1')
    })

    it('starts over once the session holds a message the thread never saw', () => {
        expect(codexThreadToResume('agent', 'session', 'cnx-a', 'msg-3')).toBeUndefined()
    })

    it('starts over on another connection', () => {
        expect(codexThreadToResume('agent', 'session', 'cnx-b', 'msg-2')).toBeUndefined()
    })

    it('knows nothing of another session', () => {
        expect(codexThreadToResume('agent', 'other', 'cnx-a', 'msg-2')).toBeUndefined()
    })

    it('forgets a session, and every thread of a swept connection', () => {
        rememberCodexThread('agent', 'kept', { ...thread, connectionId: 'cnx-b' })
        forgetCodexThread('agent', 'session')
        expect(codexThreadToResume('agent', 'session', 'cnx-a', 'msg-2')).toBeUndefined()

        rememberCodexThread('agent', 'session', thread)
        forgetCodexThreadsOf('cnx-a')
        expect(codexThreadToResume('agent', 'session', 'cnx-a', 'msg-2')).toBeUndefined()
        expect(codexThreadToResume('agent', 'kept', 'cnx-b', 'msg-2')).toBe('thread-1')
    })
})
