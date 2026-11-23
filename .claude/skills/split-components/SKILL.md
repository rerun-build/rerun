---
name: split-components
description: Keep component files small and split — one main component per file, extract heavy sub-components, pull out logic and types. Use whenever a .tsx file is swelling (several big components in one file, file over ~250 lines) or before creating a new one, to avoid ending up with monster 800+ line files.
---

# split-components — one component per file, short files

Companion to [sort-components]: `sort-components` places files **in the right feature folder**; this skill keeps **each file short and focused**. Files balloon when several big components, their logic and their types pile into one place; they become unreadable, hard to review in a diff, and painful to change.

## Rule

> **One file = one main exported component.** The file name = the component name (`AgentChat.tsx` exports `AgentChat`).

When a file grows, split it **before** it turns into a monster. Warning threshold: **~250 lines**, or **more than one "heavy" component** (state/effects/business logic) in the same file.

## What to extract (in priority order)

1. **A second heavy component** (its own state/effects/logic, or reused elsewhere) → its own file in the same feature folder, imported with the absolute alias `@/components/<folder>/<File>`.
2. **Non-visual logic** (fetch, transforms, complex handlers) → a `useXxx` hook in a neighboring file, or a `lib/` helper.
3. **Shared types/schemas** → a folder-level `types.ts`, or co-located at the top of the file of the component that owns them.
4. **Large constant arrays / config** (option lists, mappings) → a `*.constants.ts`.

## What NOT to split (tolerances)

- **Small, purely presentational local sub-components** used only by the file's main component (a `<Row>`, a private 15-line header): keep them in the file. Extracting them would create more noise than value.
- **Compound primitives in `ui/` and `ai-elements/`** (shadcn / Radix: `dropdown-menu.tsx`, `dialog.tsx`, `select.tsx`, `message.tsx`…). They deliberately export several sub-parts (`DialogTrigger`, `DialogContent`…): that's the expected compound-component pattern, **do not break them up**. The "components per file" count is misleading here.

In other words: the "one component per file" rule targets **feature** components (agent/, space/, chat/, dialogs/, layout/…), not compound primitives.

## Splitting an oversized file (procedure)

1. **List the components in the file**: `grep -nE "^(export )?(function|const) [A-Z]" <file>` → identify the main component vs the heavy sub-component candidates.
2. For each heavy candidate: create `@/components/<folder>/<SubComponentName>.tsx`, move the component + its imports there.
3. **Rewrite imports** with the absolute alias (`@/components/...`), never fragile `./Foo`.
4. Pull logic out into a hook / helper if the file is still heavy after extracting the components.
5. **Verify**: `cd apps/ui && npx tsc --noEmit` → exit 0 (all imports resolve).
6. Diff: moves should show up cleanly. Prettier is not uniform across `apps/ui`: fix indentation by hand, never `prettier --write` on a whole file.

## Before creating a new component

Don't start from a file that will host 3 components "because it's convenient". Create the right file per component from the start, placed according to [sort-components]. Splitting after the fact is more expensive than placing it well up front.

[sort-components]: ../sort-components/SKILL.md
