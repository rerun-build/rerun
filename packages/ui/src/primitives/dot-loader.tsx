"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ComponentProps } from "react";

import { cn } from "../cn";

type DotLoaderProps = {
    frames: number[][];
    dotClassName?: string;
    isPlaying?: boolean;
    duration?: number;
    repeatCount?: number;
    onComplete?: () => void;
    cols?: number;
    count?: number;
} & ComponentProps<"div">;

export const dotSpinnerFrames: number[][] = [
    [0],
    [0, 1, 3],
    [0, 1, 2, 3, 4, 6],
    [0, 1, 2, 3, 4, 5, 6, 7],
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
    [1, 2, 3, 4, 5, 6, 7, 8],
    [2, 4, 5, 6, 7, 8],
    [5, 7, 8],
    [8],
    [],
];

export const DotLoader = ({
    frames,
    isPlaying = true,
    duration = 100,
    dotClassName,
    className,
    repeatCount = -1,
    onComplete,
    cols = 7,
    count = 49,
    style,
    ...props
}: DotLoaderProps) => {
    const gridRef = useRef<HTMLDivElement>(null);
    const currentIndex = useRef(0);
    const repeats = useRef(0);
    const interval = useRef<ReturnType<typeof setInterval>>(null);

    const applyFrameToDots = useCallback(
        (dots: HTMLDivElement[], frameIndex: number) => {
            const frame = frames[frameIndex];
            if (!frame) return;

            dots.forEach((dot, index) => {
                dot.classList.toggle("active", frame.includes(index));
            });
        },
        [frames],
    );

    useEffect(() => {
        currentIndex.current = 0;
        repeats.current = 0;
    }, [frames]);

    useEffect(() => {
        if (isPlaying) {
            if (currentIndex.current >= frames.length) {
                currentIndex.current = 0;
            }
            const dotElements = gridRef.current?.children;
            if (!dotElements) return;
            const dots = Array.from(dotElements) as HTMLDivElement[];
            interval.current = setInterval(() => {
                applyFrameToDots(dots, currentIndex.current);
                if (currentIndex.current + 1 >= frames.length) {
                    if (repeatCount != -1 && repeats.current + 1 >= repeatCount) {
                        clearInterval(interval.current!);
                        onComplete?.();
                    }
                    repeats.current++;
                }
                currentIndex.current = (currentIndex.current + 1) % frames.length;
            }, duration);
        } else {
            if (interval.current) clearInterval(interval.current);
        }

        return () => {
            if (interval.current) clearInterval(interval.current);
        };
    }, [frames, isPlaying, applyFrameToDots, duration, repeatCount, onComplete]);

    return (
        <div {...props} ref={gridRef} className={cn("grid w-fit gap-0.5", className)} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, ...style }}>
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className={cn("h-1.5 w-1.5 rounded-sm", dotClassName)} />
            ))}
        </div>
    );
};
