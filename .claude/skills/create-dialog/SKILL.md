---
name: create-dialog
description: "Create a dialog in apps/ui with the existing primitives, on a single column, under the one header every dialog shares (DialogHeaderBar: icon, title, description, line under it): DialogContent for a short form, PanelDialogContent for a dialog that holds a list (AiProvidersDialog model). The 2-column frame (SplitDialogContent) is now only an exception for a live preview. Use whenever you create or redesign a dialog in the app."
---

# create-dialog: create a dialog that follows the house pattern

Every new dialog is **on a single column**. Two-column dialogs with an explainer on the right were judged heavy (feedback from 14/10/2026).

**No invented building blocks.** A dialog is assembled from what the kit (`/render/kit`, `app/render/kit/surfaces/`) already shows: `PanelRow`, `PanelList`, `PanelSection`, `PanelSteps`, `EmptyState`, `Alert`, `Badge`, `Icon`, `Progress`, `Field`, `Button`. No hardcoded brand color, no halo, colored avatar, homemade chip or tile, no added animation: a "handmade" look reads as AI slop.

## One header, everywhere

Every dialog opens on `DialogHeaderBar` (`components/dialogs/DialogHeaderBar.tsx`): an icon tile, the
title, the description, a line under it, `p-4`. It bleeds to the frame edges on its own, in a padded
`DialogContent` as in a `p-0` frame. A wizard uses `StepDialogHeader`, the same header with the
progress bars under the title. A tabbed dialog passes it as the `header` of `DialogTabs`, which keeps
one line, under the tabs.

```tsx
<DialogHeaderBar icon={KeyIcon} title={t('title')} description={t('description')} />
<DialogHeaderBar icon={<AppIcon slug="linkedin" size="md" />} title="LinkedIn Pro" description={…} actions={<Badge …/>} />
```

- Every dialog has an icon: a glyph from `@/lib/icons` (never Sparkles, Bot or Plug), or the app's
  logo when the dialog is about one app.
- No `className` on `DialogHeader` / `DialogTitle` for padding, border, size or alignment, and no
  hand-rolled title row. The body uses `p-4` too, the footer is the plain `DialogFooter`.
- Exceptions, on purpose: `ConfirmDialog`, the hero and marketing dialogs (sign-in, billing and
  plans, new coworker, subscription offer, changelog, deep links) and the full-screen viewers.

## Two frames, both already exist

| Dialog | Frame | Reference |
|---|---|---|
| Short form (rename, create a simple thing) | bare `DialogContent`, `DialogHeaderBar`, default `DialogFooter` | `RenameAgentDialog.tsx`, kit "Dialog" section |
| List with drill-in (accounts, connections, settings) | `PanelDialogContent` + `PanelSteps` | `AiProvidersDialog.tsx`, `LinkedinProDialogView.tsx` |

## Skeleton of a list dialog

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
    <PanelDialogContent className="sm:max-w-xl">
        <DialogHeaderBar icon={<AppIcon slug="linkedin" size="md" />} title="LinkedIn Pro" description="One short line." />
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

1. **shadcn primitives**: `Dialog`, `DialogFooter` from `components/ui/dialog`, the header through `DialogHeaderBar`. Do not add a house composite to `components/ui/dialog.tsx`, that file stays a faithful copy of shadcn.
2. **A service's logo**: `<Icon {...serviceIconProps(service.icon, service.category)} />` with the catalog row (`useCatalogServices`), like the app library. Never a redrawn brand SVG.
3. **Statuses**: shared `Badge` with a `tone`. Warnings: `Alert`. Empty list: `EmptyPitch` inside a group, or `EmptyState`.
4. **Opening a row**: the page slides one level down with `PanelSteps`, never a hard swap.
5. **Forbidden buttons**: disabled with `TooltipDisabledReason`. Risky actions: `ConfirmDialog`.

## Wizard variant

- Stepping comes from `@rerun/ui/steps`: `useStepper`, `StepperBar`, `StepTransition`. Never rewrite progress bars by hand.
- Header: `StepDialogHeader icon={…}` (`apps/ui/components/dialogs/StepDialogHeader.tsx`), the `DialogHeaderBar` with the progress bars under the title. In a `SplitDialogContent` the column has no padding of its own: header first, then the body in a `p-4` wrapper, the plain `DialogFooter` at the bottom (`CreateTemplateDialog.tsx`).
- `StepTransition` remounts its whole subtree at every step: a hook that has to survive going from one step to the next is declared in the shell.
- Two entry points that walk through the same wizard share the body AND the footer in a single component (see `CaptureStepPanel`).

## Exception: the 2-column frame

`SplitDialogContent` is now only for a **live preview that reflects the input** (e.g. `CreateAgentPreview` with `IsoGrid`). Never for a static explainer. The existing 2-column dialogs (`CreateSpaceDialog`, `CreateTemplateDialog`, `CaptureAgentsDialog`…) stay as they are until someone reworks them.

Simple confirmations (delete, clear, close tab) stay on `ConfirmDialog`.

## Reminders

- All UI labels in English.
- No em dashes in the copy.
- Client component (`'use client'`) like the other dialogs.
- Responsive from the first version: check at 375, 768, desktop and at 700 px tall.
- Never use the Lucide `Sparkles` icon (banned).
