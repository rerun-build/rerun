import { UNPLACED_COL } from '@/lib/board/iso'
import type { Tables } from '@/app/api/database.types'

export const AGENT_COLUMNS = ['id', 'name', 'handle', 'description', 'space_id', 'col', 'row', 'disabled_at'] as const
export const SPACE_COLUMNS = ['id', 'name', 'col_start', 'row_start', 'col_end', 'row_end'] as const

export type ForemanAgentRow = Pick<Tables<'agents'>, (typeof AGENT_COLUMNS)[number]>
export type ForemanSpaceRow = Pick<Tables<'spaces'>, (typeof SPACE_COLUMNS)[number]> & { access?: 'use' | 'manage' }

export function renderBoardMap(spaces: ForemanSpaceRow[], agents: ForemanAgentRow[], { canCreateBox, hiddenBoxes = 0 }: { canCreateBox: boolean; hiddenBoxes?: number }): string {
    if (!spaces.length && hiddenBoxes > 0) {
        return canCreateBox
            ? 'No Box of this workspace is open to the person you are talking to, so you see no coworker. They can still create their own Box with create_boxes and build coworkers in it; an admin can open other Boxes to them. Never mention or guess what the other Boxes hold.'
            : 'No Box of this workspace is open to the person you are talking to, so you see no coworker. Never mention or guess what the other Boxes hold.'
    }
    if (!spaces.length) {
        return canCreateBox
            ? 'This workspace has no Box yet, so it cannot hold a coworker. Lay the divisions of their company out with create_boxes, all of them in a single call, the one they will spend their week in first: it lands at the centre and the others are laid around its faces.'
            : 'This workspace has no Box yet, so it holds nothing at all: no coworker, no skill, no schedule. Nothing can be created at this stage of the conversation. Do not offer a Box, do not claim one exists, and do not describe a team as if it had been built.'
    }

    return spaces
        .map(space => {
            const inside = agents.filter(agent => agent.space_id === space.id)
            const reach = space.access === 'use' ? ' - they use its coworkers but cannot create, change or delete them' : ''
            const header = `Box "${space.name ?? 'Box'}" (id ${space.id}), cells col ${space.col_start}-${space.col_end}, row ${space.row_start}-${space.row_end}${reach}`
            if (!inside.length) return `${header}\n  (empty)`
            const lines = inside.map(agent => {
                const where = agent.col === UNPLACED_COL ? 'not placed on the board' : `col ${agent.col}, row ${agent.row}`
                const switchedOff = agent.disabled_at ? ' switched off,' : ''
                return `  - ${agent.name} (@${agent.handle ?? '?'}, id ${agent.id})${switchedOff} ${where}${agent.description ? ` - ${agent.description}` : ''}`
            })
            return `${header}\n${lines.join('\n')}`
        })
        .join('\n\n')
}

export const MEMBER_REACH_NOTE = 'The person you are talking to is a member, not an admin: the board above holds only the Boxes open to them. Create or change a coworker only in a Box they manage, and never mention a Box or a coworker that is not listed.'
