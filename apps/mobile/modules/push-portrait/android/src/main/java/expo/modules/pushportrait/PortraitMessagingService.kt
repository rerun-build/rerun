package expo.modules.pushportrait

import android.content.Intent
import android.os.Bundle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.model.RemoteNotificationContent
import expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import expo.modules.notifications.service.NotificationsService
import java.util.Date
import java.util.UUID

// Away from the app, Firebase draws a push itself, with the app's icon, and never asks the app. A
// coworker's push is handed over as data instead, so that the app draws it with the portrait.
// Any other push, and every push while the app is on screen, takes the path it always took.
open class PortraitMessagingService : ExpoFirebaseMessagingService() {
  override fun handleIntent(intent: Intent) {
    val extras = intent.extras
    if (extras != null && shouldTakeOver(extras)) intent.replaceExtras(asData(extras))
    super.handleIntent(intent)
  }

  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    // Here rather than where the notification is drawn: Firebase keeps the process awake for this call.
    PushSender.from(remoteMessage.data["body"])?.let { Portraits.fetch(this, it.image) }
    if (remoteMessage.data.containsKey(TAKEN_OVER)) present(remoteMessage) else super.onMessageReceived(remoteMessage)
  }

  // The notification alone, without the app's background task: Firebase starts none for a push it draws,
  // and one started here could race the app opened by a tap.
  protected open fun present(message: RemoteMessage) {
    val identifier = message.data["tag"] ?: message.messageId ?: UUID.randomUUID().toString()
    val request = NotificationRequest(identifier, RemoteNotificationContent(message), FirebaseNotificationTrigger(message))
    NotificationsService.present(this, Notification(request, Date(message.sentTime)))
  }

  protected open fun appOnScreen(): Boolean = ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)

  private fun shouldTakeOver(extras: Bundle): Boolean =
    NOTIFICATION_FLAGS.any { extras.getString(it) == "1" } && PushSender.from(extras.getString("body")) != null && !appOnScreen()

  private fun asData(extras: Bundle): Bundle = Bundle(extras).apply {
    COPIED.forEach { (field, key) -> if (getString(key) == null) notificationField(extras, field)?.let { putString(key, it) } }
    NOTIFICATION_FLAGS.forEach { remove(it) }
    putString(TAKEN_OVER, "1")
  }

  private fun notificationField(extras: Bundle, field: String): String? = PREFIXES.firstNotNullOfOrNull { extras.getString(it + field) }

  companion object {
    internal const val TAKEN_OVER = "rerunPortrait"
    private val PREFIXES = listOf("gcm.n.", "gcm.notification.")
    // What makes Firebase call a message a notification.
    private val NOTIFICATION_FLAGS = PREFIXES.map { it + "e" }
    // Where Firebase keeps what the hub wrote, and where expo-notifications reads it in a data message.
    private val COPIED = listOf("title" to "title", "body" to "message", "android_channel_id" to "channelId", "tag" to "tag")
  }
}
