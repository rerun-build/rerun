package expo.modules.liveupdate

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class CrewUpdate : Record {
  @Field var title: String = ""
  @Field var text: String = ""
  // The few characters Android 16 shows in the status bar chip, only while someone waits.
  @Field var chip: String? = null
  @Field var url: String = "rerun://"
}

// Android 16's Live Update: one ongoing notification the system promotes to the top of the shade, the
// lock screen and a chip in the status bar. Earlier versions keep it as a plain ongoing notification.
class LiveUpdateModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val manager: NotificationManager
    get() = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  override fun definition() = ModuleDefinition {
    Name("LiveUpdate")

    AsyncFunction("show") { update: CrewUpdate, channelName: String ->
      ensureChannel(channelName)
      manager.notify(NOTIFICATION_ID, build(update))
    }

    AsyncFunction("isShowing") { manager.activeNotifications.any { it.id == NOTIFICATION_ID } }

    AsyncFunction("end") { manager.cancel(NOTIFICATION_ID) }
  }

  // Low importance: the crew moving is not news. The notifications that ring stay on their own channel.
  private fun ensureChannel(name: String) {
    manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
  }

  private fun build(update: CrewUpdate): Notification {
    val open = Intent(Intent.ACTION_VIEW, Uri.parse(update.url)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon())
      .setContentTitle(update.title)
      .setContentText(update.text)
      .setStyle(Notification.BigTextStyle().bigText(update.text))
      .setContentIntent(tap)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.BAKLAVA) {
      builder.setFlag(Notification.FLAG_PROMOTED_ONGOING, true)
      update.chip?.let { builder.setShortCriticalText(it) }
    }
    return builder.build()
  }

  // The monochrome icon the notifications plugin draws for every push, else the app's own.
  private fun smallIcon(): Int {
    val drawn = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (drawn != 0) drawn else context.applicationInfo.icon
  }

  companion object {
    const val CHANNEL_ID = "crew"
    const val NOTIFICATION_ID = 7270
  }
}
