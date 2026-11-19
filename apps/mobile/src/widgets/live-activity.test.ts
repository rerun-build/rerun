import type { CrewWidgetMember, CrewWidgetProps } from './crew-props'
import { activityStepOf, syncCrewActivity } from './live-activity'

jest.mock('./CrewActivity', () => ({ __esModule: true, default: {} }))

const member = (state: CrewWidgetMember['state']): CrewWidgetMember => ({ id: state, name: state, state, line: '', badge: '', face: '', url: 'rerun://', since: null })
const crew = (...states: CrewWidgetMember['state'][]): CrewWidgetProps => ({ headline: '', crewLabel: '', needsYouLabel: '', count: 0, countCaption: '', asksLine: '', othersLine: '', members: states.map(member) })

describe('activityStepOf', () => {
    it('starts only with the app in the foreground, when someone works or waits', () => {
        expect(activityStepOf(crew('working'), false, true)).toBe('start')
        expect(activityStepOf(crew('waiting'), false, false)).toBe('none')
    })

    it('updates a running activity, from the background too', () => {
        expect(activityStepOf(crew('waiting', 'working'), true, false)).toBe('update')
    })

    it('ends once nobody works nor waits, a coworker stopped on an error included', () => {
        expect(activityStepOf(crew(), true, false)).toBe('end')
        expect(activityStepOf(crew('error'), true, true)).toBe('end')
        expect(activityStepOf(crew('error'), false, true)).toBe('none')
    })
})

const mockLiveUpdate = { show: jest.fn(async () => {}), isShowing: jest.fn(async () => false), end: jest.fn(async () => {}) }
// Read when the code runs: the factory itself runs before this file's constants exist.
jest.mock('./live-update', () => ({
    get LiveUpdate() {
        return mockLiveUpdate
    },
}))

describe('the Live Update on Android', () => {
    const { Platform } = jest.requireActual('react-native') as typeof import('react-native')
    const onAndroid = Platform.OS === 'android' ? it : it.skip

    onAndroid('keeps whoever waits on top, with the chip, and opens its conversation', async () => {
        mockLiveUpdate.isShowing.mockResolvedValueOnce(true)
        const props = { ...crew('waiting', 'working'), asksLine: 'Closer asks', needsYouLabel: 'Needs you', othersLine: '+1 at work' }
        props.members[0] = { ...props.members[0], line: 'Approve 12 emails', url: 'rerun://chat/conv-1?to=closer' }
        await syncCrewActivity(props)
        expect(mockLiveUpdate.show).toHaveBeenCalledWith({ title: 'Closer asks', text: 'Approve 12 emails · +1 at work', chip: 'Needs you', url: 'rerun://chat/conv-1?to=closer' }, 'Crew at work')
    })

    onAndroid('takes it down once nobody works nor waits', async () => {
        mockLiveUpdate.isShowing.mockResolvedValueOnce(true)
        await syncCrewActivity(crew())
        expect(mockLiveUpdate.end).toHaveBeenCalled()
    })
})
