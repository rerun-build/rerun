export const WORKSPACE_HEADER = 'x-workspace-id'

// The same, for what the browser requests on its own (an <img>, a download link, an upload's
// XHR), which no header reaches.
export const WORKSPACE_PARAM = 'workspace'

// Set by the proxy on a page being rendered, opened or navigated to, and taken off whatever else
// carries it: what a page opens on depends on the host, what it asks for afterwards names its workspace.
export const PAGE_HEADER = 'x-rerun-page'
