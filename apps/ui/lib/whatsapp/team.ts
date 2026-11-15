import { boardImageUrl } from '@/lib/og/board-image'
import { teamBoardScene, type TeamMember, type TeamStatus } from '@/lib/og/team-board'

export function teamBoardUrl(team: TeamMember[], status: TeamStatus): string {
    return boardImageUrl(teamBoardScene(team, status))
}
