---
name: shared-badge
description: Every status or label pill (In review, Published, Beta, Pro, Running…) goes through the shared Badge component from @moldwright/ui/primitives, with a BadgeTone tone, never a span hand-styled with bg-x/15 text-x. Use whenever you display a status, add a pill in a list/table/dialog, or come across a `<span className="rounded ... text-[10px]">` that serves as a badge.
---

# shared-badge: a pill = the Badge component

All of Rerun's pills come out of **a single component**: `Badge` (`packages/ui/src/primitives/badge.tsx`). It is the one that carries the `BorderBeam` ring, the glow, the soft background and the color tokens per tone. A pill copied by hand (`bg-amber-500/15 text-amber-500`) falls outside the design system: no ring, no glow, and a tint that drifts from one surface to another (case spotted: the "In review" badge in the My templates dialog did not look like the one in the admin table).

## Canonical reference

- `packages/ui/src/primitives/badge.tsx`: the component. Props `size` (`xs | sm | md | lg`, default `md`), `fill` (`soft | outline`), `tone`, `pattern`, `animated`, `glow`, `shimmer`.
- `packages/ui/src/styles.css` (`.badge-beam--<tone>`): the `--badge-fg` / `--badge-soft` tokens per tone. **A pill's color is changed there, never in the calling component.**
- Wrappers that are already official, to reuse rather than redoing a mapping:
  - `apps/ui/app/admin/_badges.tsx` → `StatusBadge` / `StatusBadgeButton` (all the admin tables).
  - `packages/ui/src/monitoring/AgentRunLogs.tsx` → `RunStatusBadge` + `RUN_STATUS_META`.
  - `apps/ui/lib/board/attention.ts` → `STATUS_META`: the status of a waiting conversation.
  - `apps/ui/lib/templates/status.ts` → `templateStatusTone` / `templateStatusLabel`: a template's status (`draft`, `in_review`, `published`, `unlisted`, `archived`) everywhere in the app. Never remap a template status by hand, and above all never display it through `titleCase` alone (`in_review` would come out as "In_review").
- `packages/ui/src/primitives/icon-badge.tsx` → `IconBadge`: **round, icon-only** pill (pricing checkmarks, chat tool statuses). Not for text.

## Rule

> A pill (status, state, short label such as Beta / Pro / New, qualified counter) is written **only** with `Badge` from `@moldwright/ui/primitives`, or one of the wrappers above. The color comes from the `tone` prop typed `BadgeTone`, never from `bg-*/10 text-*-500` classes put on a `<span>`.

Available tones (`BadgeTone`, inherited from `BorderBeam`): `brand` (default), `white`, `neutral`, `green`, `red`, `orange`, `cyan`, `yellow`. No other color: if the need does not fit, add a tone in `styles.css` + `BorderBeam.tsx`, not a local class.

## Skeleton

```tsx
import { Badge, type BadgeTone } from '@moldwright/ui/primitives'

// Status pill in a list / table / dialog: the house form
const STATUS_TONES: Record<string, BadgeTone> = {
    in_review: 'orange',
    published: 'green',
    unlisted: 'cyan',
}

<Badge size="xs" tone={STATUS_TONES[status] ?? 'neutral'} glow={false} className="font-medium">
    {statusLabel(status)}
</Badge>

// Highlighted pill (hero, pricing card, feature flag): the defaults are enough
<Badge tone="brand">Beta</Badge>
<Badge tone="brand" animated shimmer>New</Badge>
```

Anti-patterns (what the skill removes):

```tsx
// ❌ pill copied by hand
<span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500">In review</span>

// ❌ status mapped to classes instead of a tone
const STATUS_CLASS: Record<string, string> = { published: 'bg-emerald-500/15 text-emerald-500' }

// ❌ tone overridden by a local color
<Badge tone="green" className="text-emerald-300">Live</Badge>

// ❌ a real button made with a Badge: Badge renders a <span>
<Badge onClick={…}>Publier</Badge>   // → StatusBadgeButton, or a <button> that wraps the Badge
```

## Detail rules

1. **Status convention**: `size="xs"`, `glow={false}`, `className="font-medium"`. The glow is reserved for highlighted pills (hero, pricing); in a dense list it bleeds onto the neighboring rows. Uppercase (`uppercase tracking-wide`) only if the surface already does it everywhere.
2. **Same status = same tone everywhere.** Before inventing a mapping, check whether the status already exists (`STATUS_TONES` in `TemplatesAdmin.tsx`, `RUN_STATUS_META`, `STATUS_META`) and reuse the same tone. A status that reads orange in the admin does not read amber in the dialog.
3. **An unknown status falls back to `'neutral'`**, never to a hardcoded gray: `STATUS_TONES[status] ?? 'neutral'`.
4. **`Badge` is a `<span>`**: no `onClick` on it. A clickable pill = a `<button>` around it (see `StatusBadgeButton`).
5. **`className` is for layout, not for color**: `shrink-0`, `absolute`, `font-medium`, `uppercase` yes; `text-*`, `bg-*`, `border-*` no.
6. **Import**: `@moldwright/ui/primitives` (subpath) rather than the `@moldwright/ui` barrel, which pulls in the whole package.
7. **Status pill placed on an image**: the Badge's soft background is not enough over a photo. Wrap it in a `<span className="absolute … rounded-full bg-background/70 backdrop-blur">` and let the Badge carry the color (`TemplateCard`, `TemplateDetailMedia`). No color on the wrapper.

## What is NOT a pill

Do not convert: **icon chips placed on an image** that carry no state (the "Featured" of `TemplateCard` / `TemplateDetailMedia`, `bg-background/80 backdrop-blur` overlay), shortcut **`<kbd>`s**, **code / error blocks** (`rounded bg-* px-2 py-1.5` on a `<pre>`), the sidebar's round **counter bubbles**, and **free-form data tags** (memory kind, file name) that carry no state.

## Verification

- `cd apps/ui && npx tsc --noEmit` → exit 0.
- Anti-regression, spot the pills rebuilt by hand:
  ```
  rg -n "className=\"[^\"]*(bg-(amber|emerald|sky|red|orange|cyan|yellow)-[0-9]{3}/[0-9]{1,2})[^\"]*text-" apps/ui packages
  ```
  A match that wraps a status label = to switch to `Badge` + `tone`.
- Also check that no `Record<string, string>` named `*_CLASS` maps a status to color classes:
  ```
  rg -n "STATUS_CLASS|_CLASS: Record<string, string>" apps/ui packages
  ```

## Reminders

- UI labels in English, no em dashes (the `/admin` back-office stays in French for its copy).
- Client component (`'use client'`) only if the surface already is one: `Badge` has no hooks, it works as a server component.
