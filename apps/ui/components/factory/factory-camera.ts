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
