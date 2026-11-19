import type { CrewWidgetMember, CrewWidgetProps } from './crew-props'
import { activityStepOf } from './live-activity'

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
