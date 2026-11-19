---
name: loading-skeletons
description: In apps/ui, every content area that is loading shows a skeleton modeled on its own layout (never a centered spinner, never a one-size-fits-all skeleton). Use whenever you add a loading state, wire up a client fetch, or come across a Loader2Icon / Spinner in the middle of a content area.
---

# loading-skeletons: one skeleton per surface, modeled on its layout

A **content** load in `apps/ui` renders as a **skeleton shaped like what is about to appear**. Not a centered spinner, not a bare `Loader2Icon`, not a "Loading…", and above all not the same generic skeleton pasted everywhere: the goal is that between the placeholder and the real content, **nothing moves**.

## The rule

> Each surface that loads has **its own** skeleton, whose geometry is copied from the real component: same container classes, same heights, same gaps, same borders. Only the `Skeleton` primitive is shared.

The counter-example not to reproduce: `SkeletonRows` (stacked `h-4 w-full` bars) placed on a list whose rows have a thumbnail, a title and a badge. It "looks like a skeleton" without announcing anything, and the layout jumps when the data arrives. If you write `SkeletonRows`, it is almost always the sign that the skeleton was not designed.

## How to write it

1. Open the real component and read its JSX from top to bottom.
2. Copy the container hierarchy **as is** (the `border-b border-border px-4 py-3` of a row, the `grid grid-cols-1 gap-3 sm:grid-cols-2` of a grid, the `h-28` of a cover).
3. Replace each piece of content with a `<Skeleton />` at the right height/width: `h-3` for a `text-xs`, `h-3.5` for a `text-sm`, `h-9` for an `Input`, `h-8` for a `Button size="sm"`.
4. When the component is built on layout primitives (`Card` / `CardHeader` / `CardContent`, `ScrollFade`), **reuse those same primitives** in the skeleton: the geometry becomes exact for free and stays right if the primitive changes.
5. Vary the widths slightly from one line to the next (an array of widths indexed by `i`) rather than identical bars.

## Where it lives

- **A local function at the bottom of the component's file**, this is the default case:
  - `components/agent/AgentPanelMonitoring.tsx` → `MonitoringSkeleton` (the 2×`h-32` + 2×`h-56` grid of the `MonitorCard`s)
  - `components/templates/expert/ExpertTemplateList.tsx` → `ExpertTemplateListSkeleton` (`h-9 w-14` thumbnail + title + badge, modeled on `ExpertTemplateRow`)
  - `components/templates/TemplateLibraryDialog.tsx` → `TemplateCardSkeleton` (`h-28` cover, title, 2-line tagline, meta bar), rendered in the **same** responsive grid as the real cards
- **A neighboring file** when it is big: `components/templates/expert/MyTemplateEditorSkeleton.tsx` (the editor's 4 `Card`s + the agents block + the footer).
- **`components/ui/skeleton.tsx`** only if **several** surfaces really share the same shape.

## The shared catalog (reuse if and only if the shape fits)

| Variant | Shape | Example caller |
|---|---|---|
| `Skeleton` | the primitive (`animate-pulse rounded-md bg-accent`) | everywhere |
| `SkeletonList` | round avatar + label + meta on the right | `WorkspaceMembersDialog`, `CaptureSelectStep` |
| `SkeletonButtonRows` | bordered rows, `withBadge` / `extraLine` options | `AgentPanelScheduled` |
| `SkeletonServiceRows` | `size-8` icon + label + action, framed | `AgentPanelServices` |
| `SkeletonMemoryRows` | badge + 2 lines of text | `AgentPanelMemories` |
| `SkeletonFileTree` | `size-4` icon + variable-width name | `AgentPanelFiles`, `SpacePanelFiles` |
| `SkeletonTable` | header + rows, `rows`/`cols` | `AgentPanelData` |
| `SkeletonCardGrid` | bordered cards in a grid | `AgentPanelTools` |
| `SkeletonChat` | user/assistant bubbles | `AgentChat` |
| `SkeletonForm` | label+field, separators, switches, textarea | `AgentPanelSettings` |
| `SkeletonRows` | flat bars, **almost never the right choice** | - |

## The boundary: what is not a content load

- **A button mid-action** → `<Button loading>` from `@moldwright/ui/primitives` (renders a `DotLoader`). `components/ui/button.tsx` is only a re-export, so the prop is available everywhere. Do not hand-build a `Loader2Icon` inside a button.
  - Trap: `useTransition` gives **one** shared `pending`. If several buttons live in the same component, keep the running action in a state (`running === 'submit'`) so only the right one spins. See `components/templates/expert/TemplateSubmitFooter.tsx`.
- **An inline status in the chat** (`ToolCallBlock`, `CompactionBlock`) → `Spinner`.
- **The app's full-screen loading** → `AnimatedLogo` + `Shimmer`.
- An "in progress" text in a dropzone (`Uploading…`) stays text.

## The test

Devtools → network **Slow 3G**, open the surface. The skeleton must take up the same space as the content that replaces it: no vertical jump, no column changing width, no scroll moving.
