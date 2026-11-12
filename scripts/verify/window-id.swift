// Prints the CGWindowID of the visible main window of a process, for `screencapture -l`: the largest
// on-screen window of layer 0 (Electron also keeps hidden helper windows).
//   swift scripts/verify/window-id.swift <pid>
import CoreGraphics
import Foundation

let pid = Int32(CommandLine.arguments[1]) ?? 0
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
var best: (id: Int, area: Double)? = nil
for window in windows where (window[kCGWindowOwnerPID as String] as? Int32) == pid && (window[kCGWindowLayer as String] as? Int) == 0 {
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let area = (bounds["Width"] as? Double ?? 0) * (bounds["Height"] as? Double ?? 0)
    if let number = window[kCGWindowNumber as String] as? Int, area > (best?.area ?? 0) { best = (number, area) }
}
if let best { print(best.id) }
