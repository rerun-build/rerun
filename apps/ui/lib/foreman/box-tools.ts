import 'server-only'

import { workspaceActor, type Actor } from '@/app/api/_auth/access'
import { createBoxes, deleteBox, renameBox } from '@/app/api/_services/box.service'
import { asStringArray, requireConfirmation, requireString } from '@/lib/mcp/args'

export async function dispatchBoxTool(ctx: { workspaceId: number; userId: string; actor?: Actor }, name: string, args: Record<string, unknown>): Promise<unknown> {
    const actor = ctx.actor ?? workspaceActor(ctx.workspaceId)
    switch (name) {
        case 'create_boxes': {
            const names = asStringArray(args.names)
            if (!names.length) throw new Error('create_boxes needs at least one name: one per division of the organisation you are laying out.')

            const results = await createBoxes({ workspaceId: ctx.workspaceId, userId: ctx.userId, actor, names })
            const failed = results.flatMap((result, index) => (result.ok ? [] : [{ name: names[index], error: result.error }]))
            if (!results.some(result => result.ok)) throw new Error(failed[0]?.error ?? 'No Box could be created.')

            const boxes = results.flatMap(result => (result.ok ? [{ boxId: result.spaceId, name: result.name, col: result.colStart, row: result.rowStart, colEnd: result.colEnd, rowEnd: result.rowEnd }] : []))
            return failed.length ? { boxes, failed } : { boxes }
        }
        case 'rename_box': {
            await renameBox(actor, requireString(args.boxId, 'boxId'), requireString(args.name, 'name'))
            return { ok: true }
        }
        case 'delete_box': {
            requireConfirmation(args, 'a Box')
            await deleteBox(actor, requireString(args.boxId, 'boxId'))
            return { ok: true }
        }
        default:
            throw new Error(`Unknown tool: ${name}`)
    }
}
