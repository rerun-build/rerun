import { computerHandleOf, type RemoteComputerView } from '@rerun/contracts'
import { RemoteCallError } from '../../remote/connection.js'
import { listComputerViews } from '../../remote/registry.js'
import { productName, productText } from '../../brand/brand.js'

// What every tool of a linked computer says the same way: which computer, whether it can answer,
// and what went wrong on its side.

export async function findComputer(handle: string): Promise<{ view: RemoteComputerView | null; known: RemoteComputerView[] }> {
    const known = await listComputerViews()
    const wanted = computerHandleOf(handle)
    const view = known.find(computer => computer.handle === wanted) ?? known.find(computer => computer.name.toLowerCase() === handle.trim().toLowerCase()) ?? null
    return { view, known }
}

export const unknownComputer = (handle: string, known: RemoteComputerView[]) =>
    known.length === 0 ? productText('No computer is linked to this workspace. A person links one from the Rerun desktop app (account, Desktop tab).') : `No computer is called ${handle}. The linked ones: ${known.map(computer => `#${computer.handle}`).join(', ')}.`

export function unavailable(view: RemoteComputerView): string | null {
    if (!view.online) return `#${view.handle} is offline${view.lastSeenAt ? ` (last seen ${view.lastSeenAt})` : ''}: the ${productName()} app is not running on it, or it is asleep. Nothing was run. Tell the user; do not retry in a loop.`
    if (view.paused) return `#${view.handle} is paused by its owner. Nothing was run. Tell the user; it runs again once they resume it from the app.`
    return null
}

export function callFailure(view: RemoteComputerView, err: unknown): string {
    if (!(err instanceof RemoteCallError)) throw err
    const name = `#${view.handle}`
    switch (err.code) {
        case 'disconnected':
            return `${name} went offline before it answered. The command may or may not have run: check before running it again.`
        case 'paused':
            return `${name} was paused by its owner: ${err.message}`
        case 'capability_off':
            return `${name} does not offer this: ${err.message}`
        case 'timeout':
            return `${name} did not answer in time. The command may still be running there.`
        case 'cancelled':
            return `The command on ${name} was stopped.`
        case 'not_found':
            return err.message
        default:
            return `${name} refused or failed: ${err.message}`
    }
}

