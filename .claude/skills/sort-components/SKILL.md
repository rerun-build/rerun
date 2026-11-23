---
name: sort-components
description: Keep apps/ui/components organized by feature (agent/, space/, chat/, dialogs/, layout/, ui/). Use to place a new component in the right spot, or when the root of components/ starts overflowing with flat files again and needs re-sorting.
---

# sort-components: organize UI components by feature

The components in `apps/ui/components/` live in a subfolder by **functional domain**, not flat at the root. This skill places a new component correctly, or re-sorts when the root fills up again.

## Canonical structure

```
apps/ui/components/
  agent/        Agent panel + all its tabs (chat, files, skills, tools, mcp,
                scheduled, settings, memories, data) + agent-related forms/templates
  space/        Space panel + space files
  chat/         Sessions (tabs, history) + message blocks (ToolCall, Reasoning,
                Approval, attachments, mentions)
  dialogs/      Create / delete / onboarding modals
  layout/       Page shell: HomeContent, IsoBoard, Toolbar, Logo
  ui/           Low-level primitives (button, input, dialog, card…) + generic placeholders
  ai-elements/  Conversation components (prompt-input, message, conversation, reasoning…)
  services/     Service install / config / list
  auth/         Auth page decor
```

## Placement rule (new component)

1. **Is it a generic primitive** (reusable, no business logic: button, input, placeholder)? → `ui/`.
2. **Is it pure conversation** (message rendering, prompt input)? → `ai-elements/`.
3. Otherwise, sort by **feature**: it concerns an agent → `agent/`; a space → `space/`; chat sessions/blocks → `chat/`; a modal → `dialogs/`; the global shell → `layout/`.
4. When in doubt between feature and type, **the feature wins** (group by domain, not by technical nature).

> A new `.tsx` file goes in a feature folder, not at the root of `components/`.

## Import conventions

- Cross-file imports with the **absolute alias**: `@/components/<folder>/<File>` (the repo has `@/*` → `./*` in [tsconfig.json](apps/ui/tsconfig.json)). No fragile relative `./Foo` / `../Foo`.
- The `ui/` and `ai-elements/` primitives are imported with the absolute alias too (`@/components/ui/button`).

## Re-sorting when the root overflows

When files show up flat in `components/` again:

1. **Map**: `ls apps/ui/components/*.tsx` → list the flat files.
2. **Assign** each file to its feature folder according to the rule above.
3. **Move with `git mv`** (preserves history) into the right subfolder.
4. **Rewrite the imports** to each moved file with the absolute alias `@/components/<folder>/<File>`. Remember:
   - the **relative imports** `./Foo` / `../Foo` between neighbors,
   - the **relative imports into existing subfolders** (`./ui/...`, `./services/...`) that break as soon as the file changes level,
   - the **external references** from `apps/ui/app/`.
   - Spot all of it: `grep -rnE "@/components/|from ['\"]\.{1,2}/" apps/ui --include="*.tsx" --include="*.ts"`.
5. Delete the empty subfolders.

For a massive re-sort, a small Python script (basename→folder mapping, `git mv`, then an import-rewriting regex that sorts the bases **from longest to shortest** so `AgentPanel` is not replaced inside `AgentPanelChat`) is safer than doing it by hand.

## Verification

- `cd apps/ui && npx tsc --noEmit` → **exit 0** proves that every import resolves (this is the decisive check).
- `npm run lint` → no new module resolution error (`import/no-unresolved`). Ignore the pre-existing code-quality errors (`no-explicit-any`, hooks).
- `git status --short` → the files show up as **renames** (`R`), not delete+add: history is preserved.
