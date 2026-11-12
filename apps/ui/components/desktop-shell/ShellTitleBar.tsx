// The strip the desktop app's window is dragged by, drawn by the web so it follows the page's theme
// from the first paint. Rendered by the root layout only for a request of the desktop app; its
// height and color live in globals.css (`--shell-titlebar-h`).
export function ShellTitleBar() {
    return <div aria-hidden data-shell-titlebar />
}
