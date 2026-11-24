// What a horizontal scroll offset is multiplied by: `scrollLeft` counts from the reading start and runs
// negative in a right-to-left page, so "forward" is a negative `left` there.
export function readingSign(el: HTMLElement): 1 | -1 {
    return getComputedStyle(el).direction === 'rtl' ? -1 : 1
}
