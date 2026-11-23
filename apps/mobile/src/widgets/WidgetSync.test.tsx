import { act, render } from '@testing-library/react-native'
import type { Ref } from 'react'
import { PixelRatio, Platform } from 'react-native'

import type { HomeCoworker } from '@/components/home/board'

import { faceFileName } from './crew-props'
import { WidgetSync } from './WidgetSync'

// The largest face seen drawn in the Live Activity of an iPhone (3x); 264 px and more showed as a grey block
// (RER-221). Measured, not a documented limit of WidgetKit: raise it once a larger face is seen drawn.
const MAX_FACE_PIXELS = 192
const SCREEN_SCALE = 3

const mockDrawnAt: number[] = []
const mockToDataURL = jest.fn((done: (base64: string) => void, _options: { width: number; height: number }) => done('iVBOR'))
jest.mock('@/components/buddy/AgentBuddy', () => ({
    AgentBuddy: ({ size, svgRef }: { size: number; svgRef: Ref<unknown> }) => {
        mockDrawnAt.push(size)
        jest.requireActual('react').useImperativeHandle(svgRef, () => ({ toDataURL: mockToDataURL }))
        return null
    },
}))
jest.mock('./refresh', () => ({ facesDirectory: 'file:///group/widgets' }))
jest.mock('./CrewWidget', () => ({ __esModule: true, default: { updateSnapshot: jest.fn() } }))
jest.mock('./live-activity', () => ({ syncCrewActivity: jest.fn(async () => {}) }))
const mockDeleted: string[] = []
const mockOnDisk: string[] = []
jest.mock('expo-file-system', () => {
    class File {
        uri: string
        name: string
        exists = false
        constructor(directory: string, name: string) {
            this.uri = `${directory}/${name}`
            this.name = name
        }
        write = jest.fn(async () => {})
        delete() {
            mockDeleted.push(this.name)
        }
    }
    class Directory {
        path: string
        constructor(path: string) {
            this.path = path
        }
        list() {
            return mockOnDisk.map(name => new File(this.path, name))
        }
    }
    return { File, Directory }
})

const closer: HomeCoworker = { id: 'closer', name: 'Closer', handle: null, description: null, status: 'waiting_human', paused: false, spaceId: 'box', latest: { id: 'conv-closer', title: 'Approve 12 emails', updatedAt: '2026-11-19T11:59:00Z' } as HomeCoworker['latest'], pending: 0, generalSessionId: null }

describe('WidgetSync', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('saves each face whole, small enough for WidgetKit to show', async () => {
        await render(<WidgetSync coworkers={[closer]} />)
        await act(async () => {
            jest.advanceTimersByTime(1000)
        })
        const drawnAt = mockDrawnAt.at(-1)!
        const savedAt = Platform.OS === 'android' ? PixelRatio.getPixelSizeForLayoutSize(drawnAt) : drawnAt
        expect(mockToDataURL).toHaveBeenCalledWith(expect.any(Function), { width: savedAt, height: savedAt })
        expect(drawnAt * SCREEN_SCALE).toBeLessThanOrEqual(MAX_FACE_PIXELS)
    })

    it('deletes the faces an older version saved at another size, and nothing else', async () => {
        mockOnDisk.push('buddy-closer-waiting.png', 'buddy-closer-waiting-1.png', faceFileName('closer', 'waiting'), 'timeline.json')
        await render(<WidgetSync coworkers={[closer]} />)
        expect(mockDeleted).toEqual(['buddy-closer-waiting.png', 'buddy-closer-waiting-1.png'])
    })
})
