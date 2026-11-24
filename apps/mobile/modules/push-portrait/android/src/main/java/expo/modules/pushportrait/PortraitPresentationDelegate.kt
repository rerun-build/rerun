package expo.modules.pushportrait

import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.LocusIdCompat
import androidx.core.graphics.drawable.IconCompat
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationBehaviorRecord
import expo.modules.notifications.notifications.model.triggers.FirebaseNotificationTrigger
import expo.modules.notifications.service.delegates.ExpoPresentationDelegate

// Draws a coworker's notification as a conversation, its portrait at the left. Built over the one
// expo-notifications draws, which keeps its buttons, its tap, its channel and its data, and shown as that
// one when anything fails.
open class PortraitPresentationDelegate(context: Context) : ExpoPresentationDelegate(context) {
  public override suspend fun createNotification(notification: Notification, notificationBehavior: NotificationBehaviorRecord?): android.app.Notification {
    val plain = super.createNotification(notification, notificationBehavior)
    return runCatching { conversation(notification, plain) }
      .onFailure { Log.e("PushPortrait", "A push is shown without its portrait", it) }
      .getOrNull() ?: plain
  }

  private fun conversation(notification: Notification, plain: android.app.Notification): android.app.Notification? {
    val content = notification.notificationRequest.content
    val sender = PushSender.from(content.body) ?: return null
    // A push was given its portrait on arrival; a notification of the app's own has still to get it.
    val fromPush = notification.notificationRequest.trigger is FirebaseNotificationTrigger
    val portrait = (if (fromPush) Portraits.cached(context, sender.image) else Portraits.fetch(context, sender.image)) ?: return null

    val icon = IconCompat.createWithAdaptiveBitmap(Portraits.adaptive(portrait))
    val coworker = Person.Builder().setKey(sender.key).setName(sender.name).setIcon(icon).setImportant(true).build()
    CoworkerShortcuts.publish(context, sender, coworker, icon)

    // Android titles a conversation with its shortcut's name, so what the push's own title says beside the
    // name (`Scout · Question`) moves in front of the text.
    val text = listOf(sender.state, content.text.orEmpty()).filter { it.isNotBlank() }.joinToString(" · ")
    val me = Person.Builder().setName(context.applicationInfo.loadLabel(context.packageManager)).build()
    val style = NotificationCompat.MessagingStyle(me)
      .setGroupConversation(false)
      .addMessage(text, notification.originDate.time, coworker)

    return NotificationCompat.Builder(context, plain)
      .setStyle(style)
      .setShortcutId(sender.key)
      .setLocusId(LocusIdCompat(sender.key))
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setWhen(notification.originDate.time)
      .setShowWhen(true)
      .build()
  }
}
