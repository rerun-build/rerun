---
name: menu-item-icons
description: "Decide which items of a menu (DropdownMenu, ContextMenu, \"⋯\" menu, submenu) get an icon and which do not, following the Apple HIG rule and the research on icons. An icon is there to spot an item faster, never to decorate, so we do not put them everywhere. Use whenever writing or redesigning a menu, adding a DropdownMenuItem / ContextMenuItem, hesitating to put an icon on an option, or auditing a menu where \"everything has an icon\" / « tout a une icône »."
---

# menu-item-icons: an icon per item only if it helps find it

An icon in a menu has **a single role**: make the item easier to spot while scanning. It explains nothing (the label gives the meaning) and it does not decorate. Two consequences:

- an **ambiguous** icon costs more than it brings: the eye stops on it for nothing;
- an icon **on every item** no longer helps anyone: when everything has an icon, nothing stands out anymore. This is the criticism made of macOS Tahoe, which put them everywhere.

The label always stays. Never an item with an icon alone in a vertical menu.

## The test, item by item

Add an icon **only if at least one** of these cases is true:

| # | Case | Rerun examples |
|---|---|---|
| 1 | **Standard icon**, recognized in under a second by anyone | Settings (gear), Delete (trash), Download, Copy, Share, Search, Sign out, Info |
| 2 | **Concrete object** that the item refers to | a folder, a file, a coworker (AgentBuddy), a connected app (its logo), a workspace |
| 3 | **Visual action**, one that can be drawn | sort, rotate, align, enlarge, pin |
| 4 | **Key action** of the surface, the most used in the menu, *and* a clear icon exists | New coworker, Invite |

Otherwise: **no icon**. Typical examples without an icon: "Change wallpaper", "Edit widgets", "Clean up by…", "Move to another Box", "Mark all as read", any abstract or Rerun-specific label for which a metaphor would have to be invented.

Decision shortcut: **if you hesitate between two glyphs, or if you have to explain why this glyph, none is needed.**

## The rules that go with it

1. **Same action = same icon everywhere in the app.** Before choosing, look for the icon already used for this action (see Verification). The same action drawn three ways is never learned.
2. **One icon = one action.** If the glyph already serves something else in the app, pick another one or put nothing. Example: `HistoryIcon` is reserved for "Version history", "What's new" took `MegaphoneIcon`.
3. **Labels stay aligned.** In a menu where some items have an icon, the items without an icon reserve the empty column, so that the text forms a single column:
   - `DropdownMenuItem`, `DropdownMenuSubTrigger`, `DropdownMenuLabel`: `inset` prop (`pl-7` = padding 6 + icon 16 + gap 6). Only pass `inset` when it is true: `inset={false}` sets `data-inset="false"`, and the style still kicks in.
   - A menu whose items carry `gap-2` (the workspace menu) shifts the text to 30 px: the row without an icon takes `pl-7.5` there, not `inset`.
   - `ContextMenuItem` has neither `inset` nor a default icon size: icon with `className="size-4"`, item without an icon with `className="pl-7"`.
   - If **no** item in the menu has an icon, no `inset`: the menu stays compact.
   - `DropdownMenuContent` takes the width of its trigger: behind an icon button, add `w-auto` (and `whitespace-nowrap` on the items) so that the icons do not wrap the labels.
4. **Homogeneous group when possible.** Apple asks for "the whole group or nothing". In practice the previous rule wins: we do not force a doubtful icon to complete a group (the Finder itself leaves "Change Wallpaper" without an icon next to "Get Info"). If a group has only one item that deserves an icon, ask whether that group needs one.
5. **Destructive**: `variant="destructive"` already carries the color. The trash on Delete is OK (case 1), no extra warning icon.
6. **Submenu**: the chevron is set by `DropdownMenuSubTrigger`, do not add one. The submenu's label follows the same test as the other items.
7. **Checkboxes and radios** (`DropdownMenuCheckboxItem`, `DropdownMenuRadioItem`): the check is the indicator, no extra item icon except case 2 (e.g. the logo of each app in an app choice).
8. **Size and style**: Nucleo glyphs from the `@/lib/icons` shim, the primitive's default size (`size-4`), inherited color. No per-item color, no filled icon in the middle of outline ones.

## Choosing the glyph

- Go through the `nucleo-icons` skill: if the right glyph is not in the shim, add it from the pack, do not take the least bad one already imported.
- Banned icons: `Sparkles`, `BotIcon`, `Plug` (see the project memory). A coworker is drawn with `AgentBuddy`, never with a generic icon.
- An icon you cannot find in the pack is a signal for "no icon", not for an approximate glyph.

## Skeleton

```tsx
<DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={onNewFolder}>
        <FolderPlusIcon /> New folder
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={onInfo}>
        <InfoIcon /> Get info
    </DropdownMenuItem>
    <DropdownMenuItem inset onSelect={onRename}>Rename</DropdownMenuItem>
    <DropdownMenuSub>
        <DropdownMenuSubTrigger inset>Move to</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>…</DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
        <Trash2Icon /> Delete
    </DropdownMenuItem>
</DropdownMenuContent>
```

Anti-patterns:

```tsx
// ❌ an icon per item "to look nice", invented metaphors
<DropdownMenuItem><WandIcon /> Clean up by</DropdownMenuItem>
<DropdownMenuItem><LayersIcon /> Move to another Box</DropdownMenuItem>

// ❌ misaligned labels: item without an icon and without inset among items with an icon
<DropdownMenuItem><SettingsIcon /> Settings</DropdownMenuItem>
<DropdownMenuItem>Rename</DropdownMenuItem>

// ❌ same glyph for two different product actions
<DropdownMenuItem><HistoryIcon /> What's new</DropdownMenuItem>
<DropdownMenuItem><HistoryIcon /> Version history</DropdownMenuItem>

// ❌ icon alone in a vertical menu
<DropdownMenuItem aria-label="Delete"><Trash2Icon /></DropdownMenuItem>
```

## Verification

- Reread the finished menu looking **only** at the icons: each one must point to an item without reading the text. The ones that do not get dropped.
- Find the icon already used for an action before choosing one (replace `Rename`):
  ```
  rg -n -B2 -A2 "Rename" -g '*.tsx' apps/ui packages | rg "MenuItem|Icon"
  ```
- Spot mixed menus without `inset` (items with and without an icon in the same file):
  ```
  rg -n -P -U -g '*.tsx' "<DropdownMenuItem(?![^>]*inset)[^>]*>\s*[A-Za-z]" apps/ui packages
  ```
  A match in a file where other items carry an icon = add `inset`. The pattern is noisy (a `=>` in `onSelect` cuts the tag), confirm by eye.
- Check the rendering in light and dark, and on mobile (~375px): the menu does not overflow, long labels wrap or are truncated on purpose.

## Why (sources)

- **Apple HIG, Menus**: "Use menu item icons sparingly and with purpose", icons for common and key actions, file locations, connected devices, visual concepts, user-created content; "Don't display an icon if you can't find one that clearly represents the menu item"; the whole group or nothing. https://developer.apple.com/design/human-interface-guidelines/menus
- **Microsoft, Windows guide (Menus, Icons section)**: icons for the most used items, standard icons, those that illustrate the command well; "don't feel obligated to provide them for all menu items. Cryptic icons aren't helpful, create visual clutter". https://learn.microsoft.com/en-us/windows/win32/uxguide/cmd-menus
- **Byrne (1993)**, *Using icons to find documents: simplicity is critical* (INTERCHI): simple icons speed up visual search, complex ones do not.
- **McDougall, Curry and de Bruijn (1999)**: norms on 239 symbols (familiarity, concreteness, complexity, semantic distance); in use, familiarity dominates.
- **Wiedenbeck (1999)**, *Behaviour & Information Technology*: icon alone worse than label alone or icon + label; the icon brings findability, not meaning.
- **NN/g, Icon Usability (Harley, 2014)**: very few icons are universal, the others need a label.
- **tonsky, It's hard to justify Tahoe icons**: critique of macOS Tahoe, an icon everywhere wipes out the benefit, and the same action drawn in dozens of ways. https://tonsky.me/blog/tahoe-icons/

## Reminders

- UI labels in English, in sentence case, without em dashes. Ellipsis "…" only if the item opens an input before acting.
- UI feedback on a specific item = only touch that item, do not re-iconize the whole menu "for consistency".
