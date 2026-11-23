---
name: create-dialog
description: "Create a dialog in apps/ui with the existing primitives, on a single column: DialogContent for a short form, PanelDialogContent for a dialog that holds a list (AiProvidersDialog model). The 2-column frame (SplitDialogContent) is only for a live preview. Use whenever you create or redesign a dialog in the app."
---

# create-dialog: create a dialog that follows the house pattern

Every new dialog is **on a single column**: a two-column dialog with an explainer on the right reads as heavy.

**No invented building blocks.** A dialog is assembled from what the UI kit (`/render/kit` in the Rerun Cloud admin app, see `apps/ui/AGENTS.md`) already shows: `PanelRow`, `PanelList`, `PanelSection`, `PanelSteps`, `EmptyState`, `Alert`, `Badge`, `Icon`, `Progress`, `Field`, `Button`. No hardcoded brand color, no halo, colored avatar, homemade chip or tile, no added animation: a "handmade" look reads as AI slop.

## Two frames, both already exist

| Dialog | Frame | Reference |
|---|---|---|
| Short form (rename, create a simple thing) | bare `DialogContent`, default `DialogHeader` / `DialogFooter` | kit, "Dialog" section |
| List with drill-in (accounts, connections, settings) | `PanelDialogContent` + `PanelSteps` | `AiProvidersDialog.tsx`, `LinkedinProDialogView.tsx` |

## Skeleton of a list dialog

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
    <PanelDialogContent className="sm:max-w-xl">
        <DialogHeader className="border-b px-4 py-4">
            <DialogTitle>LinkedIn Pro</DialogTitle>
            <DialogDescription>One short line.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col">
            <PanelSteps stepKey={page} depth={page === 'list' ? 0 : 1}>
                {page === 'list' ? (
                    <PanelScroller className="space-y-6 p-4">
                        <Group title="Accounts" addMenu={<AddButton onClick={add} />}>
                            <PanelRow leading={<Icon size="sm" … />} title="…" description="…" actions={<Badge size="xs" tone="green">Ready</Badge>} />
                        </Group>
                    </PanelScroller>
                ) : (
                    <>
                        {/* page header: back button + icon + title + hint, see ProviderHeader */}
                        <PanelScroller className="space-y-4 p-4">{/* form, action button aligned right */}</PanelScroller>
                    </>
                )}
            </PanelSteps>
        </div>
    </PanelDialogContent>
</Dialog>
```

`Group`, `EmptyPitch` and `AddButton` are exported by `components/connections/AiProvidersPanel.tsx`: reuse them, do not copy them.

## Consistency rules

1. **shadcn primitives**: `Dialog`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` from `components/ui/dialog`. Do not add a house composite to `components/ui/dialog.tsx`, that file stays a faithful copy of shadcn.
2. **A service's logo**: `<Icon {...serviceIconProps(service.icon, service.category)} />` with the catalog row (`useCatalogServices`), like the app library. Never a redrawn brand SVG.
3. **Statuses**: shared `Badge` with a `tone`. Warnings: `Alert`. Empty list: `EmptyPitch` inside a group, or `EmptyState`.
4. **Opening a row**: the page slides one level down with `PanelSteps`, never a hard swap.
5. **Forbidden buttons**: disabled with `TooltipDisabledReason`. Risky actions: `ConfirmDialog`.

## Wizard variant

- Stepping comes from `@moldwright/ui/steps`: `useStepper`, `StepperBar`, `StepTransition`. Never rewrite progress bars by hand.
- Header: `StepDialogHeader` (`apps/ui/components/dialogs/StepDialogHeader.tsx`).
- `StepTransition` remounts its whole subtree at every step: a hook that has to survive going from one step to the next is declared in the shell.
- Two entry points that walk through the same wizard share the body AND the footer in a single component (see `CaptureStepPanel`).

## Exception: the 2-column frame

`SplitDialogContent` is only for a **live preview that reflects the input** (e.g. `CreateAgentPreview` with `IsoGrid`). Never for a static explainer. The existing 2-column dialogs (`CreateSpaceDialog`, `CreateTemplateDialog`, `CaptureAgentsDialog`…) stay as they are until someone reworks them.

Simple confirmations (delete, clear, close tab) stay on `ConfirmDialog`.

## Reminders

- All UI labels in English.
- No em dashes in the copy.
- Client component (`'use client'`) like the other dialogs.
- Responsive from the first version: check at 375, 768, desktop and at 700 px tall.
- Never use the Lucide `Sparkles` icon (banned).
