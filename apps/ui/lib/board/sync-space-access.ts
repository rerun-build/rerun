import type { AccessLevel, SpaceVisibility } from '@/app/api/_auth/access'
import { useBoardStore } from '@/stores/board.store'

export function syncBoardVisibility(spaceId: string, visibility: SpaceVisibility) {
    useBoardStore.setState(state => ({ spaces: state.spaces.map(space => (space.id === spaceId ? { ...space, visibility } : space)) }))
}

export function syncBoardGrants(spaceId: string, people: { userId: string; access: AccessLevel }[]) {
    const { spaceGrants, setSpaceGrants } = useBoardStore.getState()
    setSpaceGrants([...spaceGrants.filter(row => row.space_id !== spaceId), ...people.map(person => ({ space_id: spaceId, user_id: person.userId, access: person.access }))])
}

export function syncBoardGrant(spaceId: string, userId: string, access: AccessLevel | null) {
    const { spaceGrants, setSpaceGrants } = useBoardStore.getState()
    const others = spaceGrants.filter(row => row.space_id !== spaceId || row.user_id !== userId)
    setSpaceGrants(access ? [...others, { space_id: spaceId, user_id: userId, access }] : others)
}
