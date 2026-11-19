import { refreshWidgets } from './refresh'

const mockSnapshot = jest.fn()
jest.mock('./CrewWidget', () => ({ __esModule: true, default: { updateSnapshot: (props: unknown) => mockSnapshot(props) } }))
jest.mock('expo-widgets', () => ({ widgetsDirectory: 'file:///group/widgets/' }))
const mockDrawn = new Set(['file:///group/widgets/buddy-closer-waiting.png'])
jest.mock('expo-file-system', () => ({
    File: class {
        mockUri: string
        constructor(mockPath: string) {
            this.mockUri = mockPath
        }
        get exists() {
            return mockDrawn.has(this.mockUri)
        }
    },
}))
const mockBoard = jest.fn()
jest.mock('@/api/board', () => ({ fetchBoard: (caller: unknown) => mockBoard(caller) }))

const agent = (id: string, status: string) => ({ id, name: id, handle: null, description: null, status, disabledAt: null, spaceId: 'box' })
const overview = (agentId: string) => ({ agentId, latest: { id: `conv-${agentId}`, title: 'Task', updatedAt: '2026-11-19T11:00:00Z' }, pending: 0 })

describe('refreshWidgets', () => {
    it('reads the crew of the caller and keeps only the faces already drawn', async () => {
        mockBoard.mockResolvedValue({ agents: [agent('closer', 'waiting_human'), agent('scout', 'working')], overview: [overview('closer'), overview('scout')], boxes: [] })
        await refreshWidgets({ accessToken: 'token', workspaceId: 7 })
        expect(mockBoard).toHaveBeenCalledWith({ accessToken: 'token', workspaceId: 7 })
        const props = mockSnapshot.mock.calls[0][0]
        expect(props.members.map((member: { id: string; face: string }) => [member.id, member.face])).toEqual([
            ['closer', 'file:///group/widgets/buddy-closer-waiting.png'],
            ['scout', ''],
        ])
    })
})
