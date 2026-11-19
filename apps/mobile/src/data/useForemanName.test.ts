import { foremanLabel, foremanLabelValues, foremanNameValues } from './useForemanName'

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({}) }))
jest.mock('@/api/foreman', () => ({ fetchForemanState: jest.fn() }))
jest.mock('@/data/local-cache', () => ({ cachedForeman: () => ({ read: () => null, save: () => {} }) }))

describe('the name of the Chief of Staff', () => {
    it('reads as its default name until the workspace gave it one', () => {
        expect(foremanLabel(null)).toBe('Chief of Staff')
        expect(foremanLabel('Max')).toBe('Max')
    })

    it('picks the wording of a message from the name it carries', () => {
        expect(foremanNameValues('Max')).toEqual({ named: 'yes', name: 'Max' })
        expect(foremanNameValues(null)).toEqual({ named: 'no', name: '' })
        expect(foremanLabelValues('Chief of Staff')).toEqual({ named: 'no', name: '' })
        expect(foremanLabelValues('Max')).toEqual({ named: 'yes', name: 'Max' })
    })
})
