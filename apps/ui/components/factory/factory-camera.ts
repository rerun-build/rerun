// The part of the stage the floor is fitted in, and how far its centre moves from the stage's centre.
// The stage loses `rightInset` to a side panel, `topSpace` and `bottomSpace` to the bars, `overhead` to
// the spheres and gates that stand above the floor and `side` at each side. Shifts are in screen px.
export function floorFrame({ stage, rightInset, topSpace, bottomSpace, overhead, side }: {
    stage: { width: number; height: number }
    rightInset: number
    topSpace: number
    bottomSpace: number
    overhead: number
    side: number
}): { width: number; height: number; shiftX: number; shiftY: number } {
    return {
        width: Math.max(1, stage.width - rightInset - 2 * side),
        height: Math.max(1, stage.height - overhead - topSpace - bottomSpace),
        shiftX: -rightInset / 2,
        shiftY: (overhead + topSpace - bottomSpace) / 2,
    }
}
