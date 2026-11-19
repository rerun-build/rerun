import { useCallback, useLayoutEffect, useRef } from 'react'

// A function that keeps its identity from one render to the next and always runs the latest `fn`:
// handed to a memoized child, it never redraws it.
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
    const latest = useRef(fn)
    useLayoutEffect(() => {
        latest.current = fn
    })
    return useCallback((...args: Args) => latest.current(...args), [])
}
