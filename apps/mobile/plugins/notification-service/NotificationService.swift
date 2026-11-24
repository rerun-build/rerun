import Intents
import UIKit
import UserNotifications

// A push of a coworker shows its portrait at the left, in place of the app's icon. iOS only draws that
// for a message from a person (a communication notification), built here from the `sender` the hub put
// in the push. Whatever goes wrong, the push is shown as it came.
class NotificationService: UNNotificationServiceExtension {
  private static let downloadTimeout: TimeInterval = 10

  private let lock = NSLock()
  private var deliver: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?
  private var download: URLSessionDataTask?

  override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    deliver = contentHandler
    original = request.content

    guard let sender = Sender(userInfo: request.content.userInfo) else {
      return finish(request.content)
    }

    let task = URLSession.shared.dataTask(with: URLRequest(url: sender.image, timeoutInterval: Self.downloadTimeout)) { [weak self] data, response, _ in
      guard let self else { return }
      let portrait = (response as? HTTPURLResponse)?.statusCode == 200 ? data : nil
      self.finish(portrait.flatMap { self.content(request.content, from: sender, portrait: $0) } ?? request.content)
    }
    download = task
    task.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    download?.cancel()
    if let original { finish(original) }
  }

  // The download and the system's deadline can end at the same time, and iOS takes one answer.
  private func finish(_ content: UNNotificationContent) {
    lock.lock()
    let answer = deliver
    deliver = nil
    lock.unlock()
    answer?(content)
  }

  private func content(_ content: UNNotificationContent, from sender: Sender, portrait: Data) -> UNNotificationContent? {
    guard UIImage(data: portrait) != nil else { return nil }
    let person = INPerson(
      personHandle: INPersonHandle(value: sender.id, type: .unknown),
      nameComponents: nil,
      displayName: sender.name,
      image: INImage(imageData: portrait),
      contactIdentifier: nil,
      customIdentifier: sender.id
    )
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: content.body,
      speakableGroupName: nil,
      conversationIdentifier: sender.conversationId,
      serviceName: nil,
      sender: person,
      attachments: nil
    )
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate(completion: nil)
    return try? content.updating(from: intent)
  }
}

// Expo puts the push's `data` under `body`.
private struct Sender {
  let id: String
  let name: String
  let image: URL
  let conversationId: String

  init?(userInfo: [AnyHashable: Any]) {
    guard
      let data = userInfo["body"] as? [String: Any],
      let id = data["agentId"] as? String,
      let sender = data["sender"] as? [String: Any],
      let name = sender["name"] as? String,
      let address = sender["image"] as? String,
      let image = URL(string: address),
      image.scheme == "https"
    else { return nil }
    self.id = id
    self.name = name
    self.image = image
    self.conversationId = data["conversationId"] as? String ?? id
  }
}
