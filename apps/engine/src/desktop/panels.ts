import type { DesktopApp } from '@rerun/contracts'

export const DOCK_APPS: Array<{ app: DesktopApp; label: string; windowClass: string }> = [
    { app: 'browser', label: 'Chrome', windowClass: '[Cc]hrom' },
    { app: 'files', label: 'Files', windowClass: 'Thunar' },
    { app: 'terminal', label: 'Terminal', windowClass: 'Xfce4-terminal' },
]

export const DOCK_WINDOW_NAME = 'rerun-dock'
export const BAR_WINDOW_NAME = 'rerun-bar'
export const BAR_HEIGHT = 32

export const windowClassOf = (app: DesktopApp): string => DOCK_APPS.find(entry => entry.app === app)!.windowClass

const TITLE_FONT = '<name>Liberation Sans</name><size>10</size><weight>bold</weight>'

// A person's keyboard reaches this screen as is: with the stock bindings a Mac Cmd+E or Alt+F4 runs
// a window-manager action instead of typing in the page. No iconify button either: nothing on the
// screen lists the windows, so a minimised one could never be brought back.
export function openboxConfig(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<openbox_config xmlns="http://openbox.org/3.4/rc">',
        `<theme><name>Rerun</name><titleLayout>LMC</titleLayout><font place="ActiveWindow">${TITLE_FONT}</font><font place="InactiveWindow">${TITLE_FONT}</font></theme>`,
        '<keyboard></keyboard>',
        '</openbox_config>',
        '',
    ].join('\n')
}

const lines = (entries: Array<[string, string | number]>): string => entries.map(([key, value]) => `${key} = ${value}`).join('\n')

const PANEL = lines([
    ['panel_layer', 'top'],
    ['panel_monitor', 'all'],
    ['panel_dock', 0],
    ['wm_menu', 0],
    ['autohide', 0],
    ['strut_policy', 'follow_size'],
    ['disable_transparency', 0],
])

// The engine only answers its own key, which every process on the screen already holds.
const openOnClick = (app: DesktopApp): string =>
    `curl -fsS -m 60 -X POST -H "Authorization: Bearer $RERUN_API_KEY" -H 'content-type: application/json' -d '{"app":"${app}"}' "$RERUN_DESKTOP_ENGINE/agents/$RERUN_DESKTOP_AGENT/desktop/apps"`

// The first line an item prints is the icon tint2 draws: the one with a dot while the app has a window.
function dockItem(iconsDir: string, { app, label, windowClass }: (typeof DOCK_APPS)[number]): string {
    const icon = (state: string) => `'${iconsDir}/${app}${state}.png'`
    return lines([
        ['execp', 'new'],
        ['execp_command', `xdotool search --onlyvisible --class '${windowClass}' >/dev/null 2>&1 && echo ${icon('-open')} || echo ${icon('')}`],
        ['execp_interval', 2],
        ['execp_has_icon', 1],
        ['execp_cache_icon', 1],
        ['execp_continuous', 0],
        ['execp_markup', 0],
        ['execp_tooltip', label],
        ['execp_lclick_command', openOnClick(app)],
        ['execp_background_id', 2],
        ['execp_centered', 1],
        ['execp_padding', '4 0'],
        ['execp_icon_w', 72],
        ['execp_icon_h', 84],
    ])
}

export function dockConfig(iconsDir: string): string {
    return [
        lines([
            ['rounded', 18],
            ['border_width', 1],
            ['background_color', '#171717 85'],
            ['border_color', '#ffffff 10'],
        ]),
        lines([
            ['rounded', 12],
            ['border_width', 0],
            ['background_color', '#000000 0'],
            ['border_color', '#000000 0'],
            ['background_color_hover', '#ffffff 8'],
            ['background_color_pressed', '#4d34f7 40'],
        ]),
        lines([
            ['panel_items', 'E'.repeat(DOCK_APPS.length)],
            ['panel_size', '100% 100'],
            ['panel_margin', '0 12'],
            ['panel_padding', '10 8 6'],
            ['panel_background_id', 1],
            ['panel_position', 'bottom center horizontal'],
            ['panel_shrink', 1],
            ['panel_window_name', DOCK_WINDOW_NAME],
            ['mouse_effects', 1],
            ['tooltip_show_timeout', 0.4],
            ['tooltip_hide_timeout', 0.1],
            ['tooltip_padding', '8 5'],
            ['tooltip_background_id', 1],
            ['tooltip_font_color', '#fafafa 100'],
            ['tooltip_font', 'Liberation Sans 10'],
        ]),
        PANEL,
        ...DOCK_APPS.map(entry => dockItem(iconsDir, entry)),
        '',
    ].join('\n\n')
}

export function barConfig(): string {
    return [
        lines([
            ['rounded', 0],
            ['border_width', 0],
            ['background_color', '#0a0a0a 70'],
            ['border_color', '#000000 0'],
        ]),
        lines([
            ['panel_items', 'EFC'],
            ['panel_size', `100% ${BAR_HEIGHT}`],
            ['panel_margin', '0 0'],
            ['panel_padding', '14 0 0'],
            ['panel_background_id', 1],
            ['panel_position', 'top center horizontal'],
            ['panel_window_name', BAR_WINDOW_NAME],
        ]),
        PANEL,
        lines([
            ['execp', 'new'],
            ['execp_command', `printf '%s' "$RERUN_DESKTOP_AGENT_NAME"`],
            ['execp_interval', 0],
            ['execp_has_icon', 0],
            ['execp_continuous', 0],
            ['execp_markup', 0],
            ['execp_font', 'Liberation Sans Bold 11'],
            ['execp_font_color', '#fafafa 100'],
            ['execp_background_id', 0],
            ['execp_centered', 1],
            ['execp_padding', '0 0'],
        ]),
        lines([
            ['time1_format', '%H:%M'],
            ['time2_format', ''],
            ['time1_font', 'Liberation Sans Bold 11'],
            ['clock_font_color', '#fafafa 100'],
            ['clock_padding', '14 0'],
            ['clock_background_id', 0],
        ]),
        '',
    ].join('\n\n')
}
