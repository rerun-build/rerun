import { describe, expect, it } from 'vitest'
import { attributeWeeklyPoints } from './weekly-points.js'

const d = (t: string) => `2026-11-10T${t}:00.000Z`

const reading = (t: string, usedPercent: number, w: string) => ({
  capturedAt: d(t),
  usedPercent,
  resetsAt: w,
})

const readings = [
  reading('00:00', 10, 'W1'),
  reading('01:00', 12, 'W1'),
  reading('02:00', 13.5, 'W1'),
  reading('03:00', 2, 'W2'),
  reading('04:00', 2, 'W2'),
  reading('05:00', 3, 'W2'),
]

const spends = [
  { at: '2026-11-09T23:00:00.000Z', key: 'A', tokens: 999 },
  { at: d('00:30'), key: 'A', tokens: 300 },
  { at: d('00:45'), key: 'B', tokens: 100 },
  { at: d('01:10'), key: 'A', tokens: 100 },
  { at: d('02:30'), key: 'A', tokens: 50 },
  { at: d('02:40'), key: 'B', tokens: 50 },
  { at: d('03:30'), key: 'A', tokens: 10 },
]

describe('attributeWeeklyPoints', () => {
  it('splits each interval by tokens, restarts at a new window and reports unassigned movement', () => {
    expect(attributeWeeklyPoints(readings, spends)).toEqual({
      points: { A: 4, B: 1.5 },
      unassigned: 1,
    })
  })

  it('rounds after summing: three equal spends of one point give 0.33 each', () => {
    const result = attributeWeeklyPoints(
      [reading('00:00', 10, 'W1'), reading('01:00', 11, 'W1')],
      [
        { at: d('00:10'), key: 'X', tokens: 100 },
        { at: d('00:20'), key: 'Y', tokens: 100 },
        { at: d('00:30'), key: 'Z', tokens: 100 },
      ],
    )
    expect(result).toEqual({ points: { X: 0.33, Y: 0.33, Z: 0.33 }, unassigned: 0 })
  })

  it('does not depend on input order', () => {
    expect(attributeWeeklyPoints([...readings].reverse(), [...spends].reverse())).toEqual({
      points: { A: 4, B: 1.5 },
      unassigned: 1,
    })
  })

  it('counts a drop under the same window as a restart', () => {
    const result = attributeWeeklyPoints(
      [reading('00:00', 10, 'W1'), reading('01:00', 4, 'W1')],
      [{ at: d('00:30'), key: 'A', tokens: 10 }],
    )
    expect(result).toEqual({ points: { A: 4 }, unassigned: 0 })
  })

  it('needs two readings', () => {
    expect(attributeWeeklyPoints([reading('00:00', 10, 'W1')], spends)).toEqual({
      points: {},
      unassigned: 0,
    })
    expect(attributeWeeklyPoints([], spends)).toEqual({ points: {}, unassigned: 0 })
  })
})
