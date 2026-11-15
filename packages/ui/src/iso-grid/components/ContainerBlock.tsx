"use client";

import { type CSSProperties, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ISO_DIM_MS, ISO_DIM_OPACITY, containerDiamond } from "../iso";
import type { Container, ContainerHandle } from "../types";
import { Spinner } from "../../primitives/spinner";

type Point = { x: number; y: number };

const HANDLES = ["top", "right", "bottom", "left"] as const;

const HANDLE_NEIGHBORS: Record<ContainerHandle, readonly [ContainerHandle, ContainerHandle]> = {
  top: ["left", "right"],
  right: ["top", "bottom"],
  bottom: ["right", "left"],
  left: ["bottom", "top"],
};

const BRACKET_LEN = 13;
const BRACKET_MAX_RATIO = 0.2;
const BRACKET_GAP = 4.5;

const LABEL_STANDING_TRANSFORM = "rotate(-26.565) skewX(-26.565)";
const LABEL_FONT_SIZE = 18;
const LABEL_OFFSET = { along: 7, above: 10 };

function bracketPath(corner: Point, a: Point, b: Point) {
  const unit = (to: Point) => {
    const dx = to.x - corner.x;
    const dy = to.y - corner.y;
    const d = Math.hypot(dx, dy);
    return { x: dx / d, y: dy / d, len: Math.min(BRACKET_LEN, d * BRACKET_MAX_RATIO) };
  };
  const ua = unit(a);
  const ub = unit(b);

  const bisectorLen = Math.hypot(ua.x + ub.x, ua.y + ub.y);
  const bisector = { x: (ua.x + ub.x) / bisectorLen, y: (ua.y + ub.y) / bisectorLen };
  const sinHalfAngle = Math.abs(bisector.x * ua.y - bisector.y * ua.x);
  const offset = BRACKET_GAP / sinHalfAngle;
  const tip = {
    x: corner.x + bisector.x * offset,
    y: corner.y + bisector.y * offset,
  };

  const arm = (u: { x: number; y: number; len: number }) => `${tip.x + u.x * u.len},${tip.y + u.y * u.len}`;
  return { d: `M ${arm(ua)} L ${tip.x},${tip.y} L ${arm(ub)}`, tip };
}

function usePillHover() {
  const [over, setOver] = useState(false);
  return { over, bind: { "data-over": over ? "" : undefined, onPointerEnter: () => setOver(true), onPointerLeave: () => setOver(false) } };
}

function CenterPill({ center, label, hot: hostHot, disabled = false }: { center: Point; label: string; hot?: boolean; disabled?: boolean }) {
  const { over, bind } = usePillHover();
  const hot = hostHot || over;
  return (
    <div
      className="iso-placeholder-label absolute"
      data-hot={hot ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      {...bind}
      style={{
        left: center.x,
        top: center.y,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="iso-placeholder-label-inner flex items-center justify-center whitespace-nowrap px-3 py-[6px]">
        <span className="iso-pill-text text-[8px] leading-none">
          {label.split("").map((ch, i) => (
            <span key={i} className="iso-swap-letter">
              <span
                className="iso-swap-letter-inner"
                style={{ transitionDelay: `${i * 12}ms` }}
              >
                <span>{ch === " " ? "\u00A0" : ch}</span>
                <span className="iso-pill-text-strong">
                  {ch === " " ? "\u00A0" : ch}
                </span>
              </span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

const CTA_ROLL_MIN_MS = 2400;
const CTA_ROLL_SPREAD_MS = 3600;

function CtaTicker({ center, label, examples, hot: hostHot, still, disabled = false }: { center: Point; label: string; examples: string[]; hot: boolean; still: boolean; disabled?: boolean }) {
  const { over, bind } = usePillHover();
  const hot = hostHot || over;
  const [index, setIndex] = useState(0);
  const text = hot ? label : examples[index % examples.length];
  const [line, setLine] = useState<{ current: string; previous: string | null }>({ current: text, previous: null });
  if (line.current !== text) setLine({ current: text, previous: line.current });

  const lineRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    if (lineRef.current) setWidth(lineRef.current.offsetWidth + 1);
  }, [line.current]);

  const rolling = !hot && !still && examples.length > 1;
  useEffect(() => {
    if (!rolling) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setIndex(i => i + 1);
        schedule();
      }, CTA_ROLL_MIN_MS + Math.random() * CTA_ROLL_SPREAD_MS);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [rolling]);

  return (
    <div
      className="iso-placeholder-label absolute"
      data-hot={hot ? "" : undefined}
      data-still={still ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      {...bind}
      style={{
        left: center.x,
        top: center.y,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="iso-placeholder-label-inner flex items-center justify-center whitespace-nowrap px-3 py-[5px] text-[8px]">
        <span className="iso-cta-window" style={{ width }}>
          {line.previous !== null && (
            <span key={`out-${line.previous}`} className="iso-cta-line iso-cta-line-out iso-pill-text" aria-hidden>
              {line.previous}
            </span>
          )}
          <span key={line.current} ref={lineRef} className={`iso-cta-line iso-cta-line-in ${hot ? "iso-pill-text-strong" : "iso-pill-text"}`}>
            {line.current}
            {hot && !disabled && (
              <svg className="iso-cta-arrow" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M2 6h8M6.5 2.5 10 6l-3.5 3.5" />
              </svg>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}

type ContainerBlockProps = {
  container: Container;
  worldOffset: { left: number; top: number };
  selected: boolean;
  highlighted?: boolean;
  activeHandle?: ContainerHandle | null;
  resizing?: boolean;
  hovered?: boolean;
  still?: boolean;
  onActivate?: () => void;
  glide?: boolean;
};

export const ContainerBlock = memo(function ContainerBlock({ container, worldOffset, selected, highlighted = false, activeHandle = null, resizing = false, hovered = false, still = false, onActivate, glide = false }: ContainerBlockProps) {
  const labelGradientId = `iso-space-label-${useId()}`;

  const { path, bounds, corners, brackets } = useMemo(() => {
    const { path: svgPath, bounds: diamondBounds, corners: cornerPositions } = containerDiamond(container, worldOffset);

    const bracketPaths = {} as Record<ContainerHandle, ReturnType<typeof bracketPath>>;
    for (const handle of HANDLES) {
      const [a, b] = HANDLE_NEIGHBORS[handle];
      bracketPaths[handle] = bracketPath(cornerPositions[handle], cornerPositions[a], cornerPositions[b]);
    }

    return { path: svgPath, bounds: diamondBounds, corners: cornerPositions, brackets: bracketPaths };
  }, [container, worldOffset]);

  const zIndex = Math.min(container.col_start, container.col_end) + Math.min(container.row_start, container.row_end) + 9000;

  if (container.variant === "placeholder") {
    const center = { x: bounds.width / 2, y: bounds.height / 2 };
    const placeholderLabel = container.placeholderLabel ?? "";
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={placeholderLabel}
        className="iso-placeholder absolute rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70"
        style={{
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
          zIndex,
          pointerEvents: "auto",
          cursor: "pointer",
        }}
        onClick={onActivate}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate?.();
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <svg
          className="absolute inset-0 overflow-visible"
          width={bounds.width}
          height={bounds.height}
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        >
          <path
            className="iso-placeholder-glow"
            d={path}
            fill="none"
            strokeWidth={2}
          />
          <path
            className="iso-placeholder-outline"
            d={path}
            strokeWidth={1.5}
            strokeDasharray="6 5"
            strokeLinejoin="round"
          />
        </svg>

        <CenterPill center={center} label={placeholderLabel} />
      </div>
    );
  }

  if (container.variant === "loading") {
    const center = { x: bounds.width / 2, y: bounds.height / 2 };
    const loadingLabel = container.placeholderLabel ?? "";
    return (
      <div
        className="iso-placeholder absolute"
        style={{
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
          zIndex,
          pointerEvents: "none",
        }}
      >
        <svg
          className="absolute inset-0 overflow-visible"
          width={bounds.width}
          height={bounds.height}
          viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        >
          <path
            className="iso-placeholder-outline"
            d={path}
            strokeWidth={1.5}
            strokeDasharray="6 5"
            strokeLinejoin="round"
          />
        </svg>

        <div
          className="iso-placeholder-label absolute"
          style={{
            left: center.x,
            top: center.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <div className="iso-placeholder-label-inner flex items-center gap-1.5 whitespace-nowrap px-3 py-[6px]">
            <Spinner className="iso-pill-text size-2.5" />
            <span className="iso-pill-text text-[8px] leading-none">{loadingLabel}</span>
          </div>
        </div>
      </div>
    );
  }

  const isNeutral = container.color.toLowerCase() === "#ffffff" || container.color.toLowerCase() === "#fff";
  const ink = isNeutral ? "var(--iso-outline-hot)" : container.color;
  const emphasized = selected || highlighted;
  const ghost = !!container.ghost && !emphasized;

  const dropDuration = container.dropDuration ?? 380;
  const drawing = !!container.justPlaced && container.dropStyle === "draw";

  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      aria-label={onActivate ? container.ariaLabel : undefined}
      onKeyDown={
        onActivate
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onActivate();
              }
            }
          : undefined
      }
      className="absolute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        zIndex,
        pointerEvents: "none",
        opacity: container.dimmed ? ISO_DIM_OPACITY : undefined,
        transition: container.justPlaced ? undefined : `opacity ${ISO_DIM_MS}ms ease${glide ? ", left 150ms ease-out, top 150ms ease-out" : ""}`,
        ...(container.justPlaced && !drawing
          ? {
              animation: `iso-container-in ${dropDuration}ms cubic-bezier(0.22, 1, 0.36, 1) ${container.dropDelay ?? 0}ms backwards`,
              transformOrigin: "50% 50%",
            }
          : null),
        ...(drawing
          ? ({
              "--iso-container-draw-duration": `${dropDuration}ms`,
              "--iso-container-draw-delay": `${container.dropDelay ?? 0}ms`,
            } as CSSProperties)
          : null),
      }}
    >
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{
        width: bounds.width,
        height: bounds.height,
        overflow: "visible",
      }}
      viewBox={`0 0 ${bounds.width} ${bounds.height}`}
    >
      <path
        className={drawing ? "iso-space-shape iso-space-draw" : "iso-space-shape"}
        d={path}
        pathLength={drawing ? 1 : undefined}
        style={{
          stroke: ink,
          fill: isNeutral
            ? emphasized
              ? "rgb(var(--iso-glint) / 0.08)"
              : "rgb(var(--iso-glint) / 0.035)"
            : container.color + (highlighted ? "33" : "18"),
          strokeWidth: emphasized ? 2 : 1.5,
          strokeOpacity: ghost ? 0 : emphasized ? 1 : isNeutral ? 0.35 : 0.7,
        }}
      />
      <path
        className={ghost ? "iso-space-dash iso-space-dash-ghost" : "iso-space-dash"}
        data-on={highlighted || ghost ? "" : undefined}
        d={path}
        style={isNeutral ? undefined : { stroke: ink }}
        fill="none"
        strokeWidth={1.5}
        strokeOpacity={0.5}
        strokeDasharray="6 5"
        strokeLinejoin="round"
      />
      {container.label ? (
        <>
          <defs>
            <linearGradient id={labelGradientId} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={ink} stopOpacity={1} />
              <stop offset="0.72" stopColor={ink} stopOpacity={0.2} />
            </linearGradient>
          </defs>
          <g
            className={drawing ? "iso-space-draw-label" : undefined}
            transform={`translate(${corners.left.x}, ${corners.left.y}) ${LABEL_STANDING_TRANSFORM}`}
          >
            <text
              className="iso-space-label"
              x={LABEL_OFFSET.along}
              y={-LABEL_OFFSET.above}
              fontSize={LABEL_FONT_SIZE}
              fontWeight={700}
              style={{ fill: `url(#${labelGradientId})`, fillOpacity: selected ? 1 : ghost ? 0.6 : 0.9 }}
            >
              {container.label}
            </text>
          </g>
        </>
      ) : null}
      <g className="iso-space-handles" data-selected={selected && !container.readOnly ? "" : undefined}>
        <path
          className="iso-space-dash"
          d={path}
          fill="none"
          strokeWidth={1}
          strokeOpacity={0.3}
          strokeDasharray="4 3"
        />
        {HANDLES.map((handle, i) => {
          const { d, tip } = brackets[handle];
          const active = activeHandle === handle;
          const transformOrigin = `${tip.x}px ${tip.y}px`;
          return (
            <g
              key={handle}
              className="iso-resize-corner"
              style={{ transformOrigin, transitionDelay: `${i * 45}ms` }}
            >
              <g
                className="iso-resize-corner-hit"
                data-handle={handle}
                data-active={active ? "" : undefined}
                data-resizing={active && resizing ? "" : undefined}
                style={{ transformOrigin }}
              >
                <path
                  className="iso-resize-corner-glow"
                  d={d}
                  fill="none"
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  className="iso-resize-corner-arm"
                  d={d}
                  fill="none"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          );
        })}
      </g>
    </svg>
    {container.cta && container.ctaExamples?.length ? (
      <CtaTicker center={{ x: bounds.width / 2, y: bounds.height / 2 }} label={container.cta} examples={container.ctaExamples} hot={hovered || selected} still={still} disabled={container.ctaDisabled} />
    ) : container.cta ? (
      <CenterPill center={{ x: bounds.width / 2, y: bounds.height / 2 }} label={container.cta} hot={hovered || selected} disabled={container.ctaDisabled} />
    ) : null}
    </div>
  );
});
