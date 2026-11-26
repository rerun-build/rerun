import { MESSAGE_NOT_FOUND } from '@rerun/contracts'
import { Hono } from 'hono'
import { getSession, listSessions, sessionBelongsToAgent } from '../../db/repos/sessions.js'
import { deleteConversationMessage, listMessages } from '../../db/repos/messages.js'
import { forgetCodexThread } from '../../agents/codex-threads.js'
import { newId } from '../../lib/ids.js'
import { claimSession, releaseSession } from '../../runtime/run-control.js'

export const sessionRoutes = new Hono()

sessionRoutes.get('/', async c => {
    const agentId = c.req.param('id')!
    return c.json({ sessions: await listSessions(agentId) })
})

sessionRoutes.get('/:sid', async c => {
    const agentId = c.req.param('id')!
    const session = await getSession(agentId, c.req.param('sid'))
    if (!session || session.agentId !== agentId) return c.json({ error: 'session not found' }, 404)
    return c.json(session)
})

sessionRoutes.get('/:sid/messages', async c => {
    const agentId = c.req.param('id')!
    const sid = c.req.param('sid')
    if (!(await sessionBelongsToAgent(sid, agentId))) return c.json({ error: 'session not found' }, 404)
    return c.json({ messages: await listMessages(agentId, sid) })
})

sessionRoutes.delete('/:sid/messages/:mid', async c => {
    const agentId = c.req.param('id')!
    const sid = c.req.param('sid')
    if (!(await sessionBelongsToAgent(sid, agentId))) return c.json({ error: 'session not found' }, 404)
    // A run reads the history it started with and writes after it: a message taken out under it
    // would come back with its next write, or leave the model answering what is no longer there.
    // The session is held while the rows go, so a message sent meanwhile waits for a settled history.
    const holdId = `delete-${newId()}`
    if (claimSession(sid, holdId)) return c.json({ error: 'a run is in flight on this session', code: 'run_in_flight' }, 409)
    try {
        const deletedIds = await deleteConversationMessage(agentId, sid, c.req.param('mid'))
        if (!deletedIds) return c.json({ error: 'message not found', code: MESSAGE_NOT_FOUND }, 404)
        forgetCodexThread(agentId, sid)
        return c.json({ deletedIds })
    } finally {
        releaseSession(holdId)
    }
})
