import { unlinkByToken } from '@/app/api/_services/remote-computers.service'

// Called by the desktop app when the person unlinks the computer from the computer itself: its own
// token is the proof, so it works whoever they are in the workspace, admin or not.
export async function POST(req: Request): Promise<Response> {
    const header = req.headers.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token || token.length > 200) return Response.json({ error: 'invalid' }, { status: 401 })
    try {
        return (await unlinkByToken(token)) ? Response.json({ ok: true }) : Response.json({ error: 'invalid' }, { status: 401 })
    } catch (error) {
        console.error('[computers] unlink failed', error)
        return Response.json({ error: 'internal' }, { status: 500 })
    }
}
