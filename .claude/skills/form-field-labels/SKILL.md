---
name: form-field-labels
description: In apps/ui, every form field (Input, Textarea, Select, Combobox, Switch, Checkbox) gets its title through the shared Field component styled text-xs font-medium text-muted-foreground, never a hand-written title or an ad hoc style. Use whenever you add or redesign a form field in the app.
---

# form-field-labels: title a field through the Field component

Every form field title in `apps/ui` goes through **a single component**: `Field` (`apps/ui/components/ui/field.tsx`). Before the unification, ~9 label styles coexisted (`text-sm font-semibold`, `text-[12px] font-medium text-foreground`, `text-xs font-medium text-muted-foreground`, uppercase, hardcoded `neutral-*` colors…) and the `Select`/`Combobox`/`Switch` each had a title rewritten by hand. This skill keeps the rule in place: **never an improvised field title**.

The chosen design (the only one): **`text-xs font-medium text-muted-foreground`**, carried by `Field`.

## Canonical reference

- `apps/ui/components/ui/field.tsx`: the component. Two orientations (`column` by default, `row` for Switch/Checkbox), + `optional` / `helperText` / `error` / `htmlFor` slots.
- `apps/ui/components/ui/input.tsx` and `textarea.tsx`: `Input` and `Textarea` **delegate** their `label` prop to `Field`. So `<Input label="…" />` already produces the right title, never wrap it on top of that.
- Example of good usage: `apps/ui/components/account/LanguagePanel.tsx` (Field + Select).

## Rule

> An input field (Input, Textarea, Select, Combobox) or a named boolean setting (Switch, Checkbox) gets its title **only** through `Field`: directly, or through the `label` prop of `Input`/`Textarea` (which delegates to `Field`). Never a hand-written `<p>`/`<span>`/`<label>` above a field, never a hardcoded title class.

## Skeleton

```tsx
import { Field } from '@/components/ui/field'

// Input / Textarea: label PROP (do not wrap in Field)
<Input label="Full name" placeholder="Ada Lovelace" />
<Textarea label="Bio" optional helperText="Shown on your public profile" />

// Select / Combobox: Field wrapper (they have no label prop)
<Field label="Role" htmlFor="role">
    <Select value={role} onValueChange={setRole}>
        <SelectTrigger id="role"><SelectValue placeholder="Select a role" /></SelectTrigger>
        <SelectContent>{/* items */}</SelectContent>
    </Select>
</Field>

<Field label="Favorite fruit">
    <Combobox groups={groups} value={fruit} onChange={setFruit} />
</Field>

// Switch / Checkbox: Field orientation="row" (label on the left, control on the right)
<Field orientation="row" label="Email notifications" helperText="Send me product updates.">
    <Switch checked={on} onCheckedChange={setOn} />
</Field>
```

Anti-patterns (what the skill removes):

```tsx
// ❌ hand-written title above the field
<div className="space-y-1.5">
    <p className="text-xs font-medium text-muted-foreground">Model</p>
    <Select …>…</Select>
</div>

// ❌ double title: label prop AND Field around it
<Field label="Name"><Input label="Name" …/></Field>

// ❌ ad hoc title class (font-semibold, text-[12px], hardcoded neutral-*, uppercase…)
<label className="text-sm font-semibold">Name</label>
```

## Detail rules

1. **htmlFor**: only set it if a real `id` exists on the control. `Select` → `id` on `<SelectTrigger>` + `htmlFor` on `Field`. `Combobox` and custom buttons have no `id` prop → no `htmlFor` (the label stays unassociated, that is acceptable).
2. **helperText / error**: a hint goes in `helperText` (gray, under the field); an error outside react-hook-form goes in `error` (red). Do not combine `error` with a `<FormMessage/>`.
3. **List rows ≠ fields**: a row where the label is **data** (an agent, tool or provider name) with an activation Switch is NOT a form field: do not turn it into a `Field`. `Field` is reserved for input fields and boolean settings **with a hardcoded name**.
4. **Table selection checkboxes** (select-all / per-row, `aria-label` only): stay without a visible title.

## react-hook-form integration

`FormControl` (`components/ui/form.tsx`) is a `Slot` that injects `id` / `aria-invalid` / `aria-describedby` into its **single child**. So:

- NEVER put `Field` as a direct child of `FormControl` (it would swallow those props).
- For an `Input`/`Textarea`: keep the `label` prop on the control **inside** the `FormControl` (the simplest), the error is still rendered by `<FormMessage/>`.
- For a `Select`/`Combobox`: wrap `FormControl` in `Field`, never the other way around:
  ```tsx
  <FormItem>
      <Field label="Role">
          <FormControl>
              <Select …><SelectTrigger>…</SelectTrigger>…</Select>
          </FormControl>
      </Field>
      <FormMessage />
  </FormItem>
  ```
- `FormLabel`/`Label` no longer exist: do not bring them back.

## Verification

- `cd apps/ui && npx tsc --noEmit` → exit 0.
- Anti-regression: no hand-written field title should come back. Spot the suspects:
  ```
  rg -n "className=\"[^\"]*text-(xs|sm|\[1[0-3]px\]) font-(medium|semibold)" apps/ui/components apps/ui/app
  ```
  A match right above a `Select`/`Combobox`/`Switch`/`Input` = to convert to `Field`.

## Reminders

- UI labels in English, no em dashes.
- Imports with the absolute alias: `@/components/ui/field`.
- Client component (`'use client'`) if the field is interactive.
