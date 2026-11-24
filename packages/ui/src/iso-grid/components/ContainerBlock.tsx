"use client";

import { type CSSProperties, memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ISO_DIM_MS, ISO_DIM_OPACITY, containerDiamond } from "../iso";
import type { Container, ContainerHandle } from "../types";
import { Spinner } from "../../primitives/spinner";

type Point = { x: number; y: number };

const HANDLES = ["top", "right", "bottom", "left"] as const;

// Les deux pointes voisines de chaque pointe du losange (cycle top → right → bottom → left).
const HANDLE_NEIGHBORS: Record<ContainerHandle, readonly [ContainerHandle, ContainerHandle]> = {
  top: ["left", "right"],
  right: ["top", "bottom"],
  bottom: ["right", "left"],
  left: ["bottom", "top"],
};

const BRACKET_LEN = 13;
// Sur un space 1x1, deux bras de longueur fixe couvriraient presque toute l'arête (31.3 unités) et le
// coin se lirait comme un contour plein : on les borne pour garder un vide au milieu de chaque arête.
const BRACKET_MAX_RATIO = 0.2;
// Le contour du space sélectionné est déjà un trait blanc plein : un coin posé sur l'arête s'y
// confondrait. On le rentre plutôt que de le laisser déborder. C'est un écart
// PERPENDICULAIRE aux arêtes : les pointes du losange n'ayant pas le même angle (26.57° à gauche et à
// droite, 63.43° en haut et en bas), un décalage constant le long de la bissectrice donnerait des
// écarts deux fois plus grands en haut et en bas.
const BRACKET_GAP = 4.5;

// Le label est un panneau DEBOUT sur l'arête haut-gauche du losange : le plan vertical de la scène
// iso. rotate(-26.565) skewX(-26.565) = matrix(0.894427, -0.447214, 0, 1.118034) : l'axe x du texte
// suit l'arête (direction iso 2:-1) et son axe y reste strictement vertical à l'écran, donc les
// jambages des lettres sont d'aplomb. Le cisaillement que cela induit ne se lit comme de la
// perspective qu'au-dessus d'une certaine taille : sous ~16px il vire au faux italique, d'où
// LABEL_FONT_SIZE qui n'est pas négociable à la baisse.
const LABEL_STANDING_TRANSFORM = "rotate(-26.565) skewX(-26.565)";
const LABEL_FONT_SIZE = 18;
// `along` court le long de l'arête, `above` est une vraie hauteur écran (l'axe y du repère debout est
// vertical), donc le mot décolle du sol de la même distance sur toute sa longueur.
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
  // sin du demi-angle au sommet : la bissectrice et une arête sont toutes deux unitaires.
  const sinHalfAngle = Math.abs(bisector.x * ua.y - bisector.y * ua.x);
  const offset = BRACKET_GAP / sinHalfAngle;
  const tip = {
    x: corner.x + bisector.x * offset,
    y: corner.y + bisector.y * offset,
  };

  const arm = (u: { x: number; y: number; len: number }) => `${tip.x + u.x * u.len},${tip.y + u.y * u.len}`;
  return { d: `M ${arm(ua)} L ${tip.x},${tip.y} L ${arm(ub)}`, tip };
}

// La pastille répond à son propre survol, en plus de celui de son hôte : c'est elle qu'on vise, et le
// survol de la Box seule ne dit pas que le curseur est dessus. Le clic n'est pas retenu ici, il
// remonte au board qui sélectionne la Box.
function usePillHover() {
  const [over, setOver] = useState(false);
  return { over, bind: { "data-over": over ? "" : undefined, onPointerEnter: () => setOver(true), onPointerLeave: () => setOver(false) } };
}

// Arabic letters join and both scripts run right to left: cut letter by letter in the left-to-right
// board, the word comes out detached and reversed. The text decides, not the language of the page: an
// untranslated label stays left to right.
const RIGHT_TO_LEFT_SCRIPT = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;

// Arabic, Hebrew and Chinese glyphs go past the one-em line a Latin letter is cut to.
const TALL_SCRIPT = /[\u0590-\u08ff\u3000-\u9fff\ufb1d-\ufdff\ufe70-\uffef]/;

function textDirection(text: string) {
  return RIGHT_TO_LEFT_SCRIPT.test(text) ? "rtl" : undefined;
}

// La pastille posée au centre du losange, dont chaque lettre bascule au survol de son hôte : le
// fantôme d'onboarding, ou une vraie Box qui porte un `cta`.
function CenterPill({ center, label, hot: hostHot, disabled = false }: { center: Point; label: string; hot?: boolean; disabled?: boolean }) {
  const { over, bind } = usePillHover();
  const hot = hostHot || over;
  const direction = textDirection(label);
  const pieces = direction === "rtl" ? [label] : label.split("");
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
        <span dir={direction} className="iso-pill-text text-[8px] leading-none">
          {pieces.map((ch, i) => (
            <span key={i} className={TALL_SCRIPT.test(label) ? "iso-swap-letter iso-swap-tall" : "iso-swap-letter"}>
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

// Chaque pastille tire son propre délai à chaque tour : à période fixe, les Box vides d'un board
// battraient la mesure ensemble.
const CTA_ROLL_MIN_MS = 2400;
const CTA_ROLL_SPREAD_MS = 3600;

// La pastille d'une vraie Box qui a de quoi tenter : au repos elle fait défiler ses exemples, au
// survol elle s'arrête sur l'action. `still` fige le défilement et retire les animations, que la
// pause du board laisserait sinon bloquées sur une ligne invisible.
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
            <span key={`out-${line.previous}`} dir={textDirection(line.previous)} className="iso-cta-line iso-cta-line-out iso-pill-text" aria-hidden>
              {line.previous}
            </span>
          )}
          <span key={line.current} ref={lineRef} dir={textDirection(line.current)} className={`iso-cta-line iso-cta-line-in ${hot ? "iso-pill-text-strong" : "iso-pill-text"}`}>
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
  // Mis en valeur pendant le placement d'une tile : indique le container que la tile survolée cible.
  highlighted?: boolean;
  // Poignée de resize survolée ou en cours de drag.
  activeHandle?: ContainerHandle | null;
  resizing?: boolean;
  // Le curseur est sur le container : sa pastille `cta` y répond, le wrapper étant transparent au pointeur.
  hovered?: boolean;
  // Board en pause, hors écran ou en reduced motion : la pastille `cta` ne défile plus.
  still?: boolean;
  // Activation clavier/clic du variant 'placeholder' (le rendre focusable et actionnable au clavier
  // plutôt que de dépendre du hit-test pointeur de l'IsoGrid).
  onActivate?: () => void;
  // Le container change de cellule sous la main de l'utilisateur, ou y revient : il glisse au même
  // pas que ses tiles au lieu de sauter devant elles.
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

  // Variant « placeholder » : container fantôme incitatif. La sélection (clic) est gérée par
  // l'IsoGrid comme tout container ; l'app hôte intercepte l'id pour ouvrir son dialog de création.
  if (container.variant === "placeholder") {
    // Le losange iso est symétrique : le centre de sa boîte englobante = son centre.
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

  // Variant « loading » : même fantôme que le placeholder, mais l'agent est en cours de création
  // (le temps que l'espace réel soit inséré). Non cliquable (pointer-events none), spinner + label
  // statique au centre. Réutilise les animations continues du placeholder (pointillés qui défilent,
  // shine de la pilule).
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
            <span dir={textDirection(loadingLabel)} className="iso-pill-text text-[8px] leading-none">{loadingLabel}</span>
          </div>
        </div>
      </div>
    );
  }

  // Space « neutre » : couleur par défaut (#fff dans les données). On la rend bien plus discrète (fond et contour
  // atténués, proche de la douceur du placeholder d'onboarding) tout en gardant un trait plein —
  // pour qu'elle se lise comme une space réelle/occupée, pas comme un fantôme pointillé.
  const isNeutral = container.color.toLowerCase() === "#ffffff" || container.color.toLowerCase() === "#fff";
  // Le blanc « neutre » des données disparaîtrait sur un fond clair : on le remplace par l'encre du thème.
  const ink = isNeutral ? "var(--iso-outline-hot)" : container.color;
  const emphasized = selected || highlighted;
  // Le contour plein passe la main au pointillé qui défile : c'est lui, et pas une opacité plus
  // basse, qui dit que l'empreinte n'a pas encore été creusée. Les deux couches sont déjà montées,
  // donc le passage se fait par une transition et non par un remplacement de nœud.
  const ghost = !!container.ghost && !emphasized;

  const dropDuration = container.dropDuration ?? 380;
  const drawing = !!container.justPlaced && container.dropStyle === "draw";

  // Wrapper focusable : le visuel reste `pointer-events: none` (clic/resize passent par le hit-test
  // racine de l'IsoGrid), mais l'élément est focusable au clavier et nommé pour les lecteurs d'écran.
  // Actionnable seulement si l'hôte a fourni onActivate (sinon usage décoratif/read-only).
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
        // Mise en retrait portée par le wrapper : elle emporte le losange, son remplissage et le
        // label debout d'un coup, là où les poser un par un les ferait s'éteindre séparément.
        opacity: container.dimmed ? ISO_DIM_OPACITY : undefined,
        // Pas pendant l'entrée : le keyframe pilote déjà l'opacité, et une transition posée dessus
        // rejouerait un fondu au moment où il rend la main.
        transition: container.justPlaced ? undefined : `opacity ${ISO_DIM_MS}ms ease${glide ? ", left 150ms ease-out, top 150ms ease-out" : ""}`,
        // `backwards` : sans lui le container est peint en entier pendant son délai, puis clignote au
        // départ de l'animation. En style 'draw' le wrapper ne bouge pas : ce sont le contour et le
        // label qui jouent, et un fade du bloc entier par-dessus écraserait le tracé.
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
        // Normalise la longueur du losange à 1 : le dash se règle sur la forme sans mesure JS, donc
        // sans ref ni effet, et le tracé reste correct quelle que soit la taille du container.
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
            {/* La bbox d'un <text> SVG va de l'ascendante à la descendante, pas du haut au bas de
                l'encre : une rampe étalée jusqu'à 1 dépense son dernier tiers dans le vide sous la
                ligne de base et le fade ne se lit plus. Elle s'arrête donc à 0.72, au bas des
                glyphes et non sous eux. */}
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
      {/* Toujours monté : un démontage React ne s'anime pas, la sortie de sélection doit pouvoir
          rejouer la transition à l'envers. */}
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
              {/* Groupe séparé pour le scale de survol : sur le même nœud il se disputerait
                  `transform` avec l'entrée, et hériterait de son délai de cascade. */}
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
