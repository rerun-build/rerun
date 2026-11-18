import ExpoModulesCore
import ObjectiveC
import UIKit

// React Native's text view only pastes text: an image on the pasteboard leaves Paste out of its menu
// and does nothing when the keyboard's own Paste is tapped. In the composer, and only there, Paste
// hands the images to JS as JPEG files, to become attachments; the text next to them, if any, is
// pasted as usual.
//
// A multiline text view also turns Return into a new line, whatever the keyboard. On a hardware
// keyboard (an iPad's), Return without Shift sends the message instead, as in Messages; the on-screen
// keyboard's Return and Shift+Return still add a line.
public class ComposerPasteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ComposerPaste")

    Events("onPasteImages", "onHardwareReturn")

    OnCreate {
      DispatchQueue.main.async { ComposerPaste.install() }
    }

    OnStartObserving("onPasteImages") {
      ComposerPaste.onImages = { [weak self] uris in
        self?.sendEvent("onPasteImages", ["uris": uris])
      }
    }

    OnStopObserving("onPasteImages") {
      ComposerPaste.onImages = nil
    }

    OnStartObserving("onHardwareReturn") {
      ComposerPaste.onReturn = { [weak self] in
        self?.sendEvent("onHardwareReturn")
      }
    }

    OnStopObserving("onHardwareReturn") {
      ComposerPaste.onReturn = nil
    }
  }
}

enum ComposerPaste {
  // The composer's `testID`, which React Native sets on the view wrapping its text view.
  static let composerIdentifier = "composer-input"
  static var onImages: (([String]) -> Void)?
  static var onReturn: (() -> Void)?
  private static var installed = false
  private static let returnAction = NSSelectorFromString("rerunComposerHardwareReturn:")

  static func install() {
    guard !installed, let textView = NSClassFromString("RCTUITextView") else { return }
    installed = true
    replaceCanPerformAction(of: textView)
    replacePaste(of: textView)
    addReturnAction(to: textView)
    replaceKeyCommands(of: textView)
  }

  private static func addReturnAction(to cls: AnyClass) {
    let action: @convention(block) (UIView, UIKeyCommand) -> Void = { _, _ in onReturn?() }
    _ = class_addMethod(cls, returnAction, imp_implementationWithBlock(action), "v@:@")
  }

  // Asked again at every key press, so the command is there only while the composer listens. While a
  // word is still being composed (Japanese, Chinese input), Return confirms it and sends nothing.
  private static func replaceKeyCommands(of cls: AnyClass) {
    let selector = #selector(getter: UIResponder.keyCommands)
    guard let method = ownMethod(selector, of: cls) else { return }
    typealias Original = @convention(c) (AnyObject, Selector) -> NSArray?
    let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
    let replacement: @convention(block) (UIView) -> NSArray? = { view in
      let inherited = original(view, selector)
      guard onReturn != nil, isComposer(view), (view as? UITextInput)?.markedTextRange == nil else { return inherited }
      let send = UIKeyCommand(input: "\r", modifierFlags: [], action: returnAction)
      send.wantsPriorityOverSystemBehavior = true
      return (((inherited as? [UIKeyCommand]) ?? []) + [send]) as NSArray
    }
    method_setImplementation(method, imp_implementationWithBlock(replacement))
  }

  // Only the class's own method is replaced, never the one UITextView hands down to every text view.
  private static func ownMethod(_ selector: Selector, of cls: AnyClass) -> Method? {
    guard let inherited = class_getInstanceMethod(cls, selector) else { return nil }
    _ = class_addMethod(cls, selector, method_getImplementation(inherited), method_getTypeEncoding(inherited))
    return class_getInstanceMethod(cls, selector)
  }

  private static func replaceCanPerformAction(of cls: AnyClass) {
    let selector = #selector(UIResponder.canPerformAction(_:withSender:))
    guard let method = ownMethod(selector, of: cls) else { return }
    typealias Original = @convention(c) (AnyObject, Selector, Selector, AnyObject?) -> Bool
    let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
    let replacement: @convention(block) (UIView, Selector, AnyObject?) -> Bool = { view, action, sender in
      if original(view, selector, action, sender) { return true }
      return action == #selector(UIResponderStandardEditActions.paste(_:)) && takesImages(view) && UIPasteboard.general.hasImages
    }
    method_setImplementation(method, imp_implementationWithBlock(replacement))
  }

  private static func replacePaste(of cls: AnyClass) {
    let selector = #selector(UIResponderStandardEditActions.paste(_:))
    guard let method = ownMethod(selector, of: cls) else { return }
    typealias Original = @convention(c) (AnyObject, Selector, AnyObject?) -> Void
    let original = unsafeBitCast(method_getImplementation(method), to: Original.self)
    let replacement: @convention(block) (UIView, AnyObject?) -> Void = { view, sender in
      if takesImages(view), UIPasteboard.general.hasImages, let handler = onImages {
        let uris = write(UIPasteboard.general.images ?? [])
        if !uris.isEmpty {
          handler(uris)
          if !UIPasteboard.general.hasStrings { return }
        }
      }
      original(view, selector, sender)
    }
    method_setImplementation(method, imp_implementationWithBlock(replacement))
  }

  private static func takesImages(_ view: UIView) -> Bool {
    onImages != nil && isComposer(view)
  }

  private static func isComposer(_ view: UIView) -> Bool {
    var current: UIView? = view
    while let candidate = current {
      if candidate.accessibilityIdentifier == composerIdentifier { return true }
      current = candidate.superview
    }
    return false
  }

  // JPEG at the quality the photo picker uses, in the caches iOS may empty: the upload reads it once.
  private static func write(_ images: [UIImage]) -> [String] {
    let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("composer-paste", isDirectory: true)
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return images.compactMap { image in
      guard let data = image.jpegData(compressionQuality: 0.8) else { return nil }
      let file = folder.appendingPathComponent("pasted-\(UUID().uuidString.prefix(8).lowercased()).jpg")
      guard (try? data.write(to: file)) != nil else { return nil }
      return file.absoluteString
    }
  }
}
