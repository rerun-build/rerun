package expo.modules.pushportrait

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.core.app.Person
import androidx.core.content.LocusIdCompat
import androidx.core.content.edit
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

// Android draws the sender at the left of a notification only for a conversation, and a conversation is a
// long-lived shortcut of the app. One per coworker that sent a push, which the launcher lists too.
internal object CoworkerShortcuts {
  private const val PUBLISHED = "push-portrait-shortcuts"

  // The system refuses an app in the background that publishes too often: only what changed is.
  fun publish(context: Context, sender: PushSender, person: Person, icon: IconCompat) {
    val published = context.getSharedPreferences(PUBLISHED, Context.MODE_PRIVATE)
    val signature = "${sender.name}\n${sender.image}\n${sender.url}"
    if (published.getString(sender.key, null) == signature && exists(context, sender.key)) return

    val open = Intent(Intent.ACTION_VIEW, Uri.parse(sender.url)).setPackage(context.packageName)
    val shortcut = ShortcutInfoCompat.Builder(context, sender.key)
      .setShortLabel(sender.name)
      .setIcon(icon)
      .setIntent(open)
      .setPerson(person)
      .setLocusId(LocusIdCompat(sender.key))
      .setLongLived(true)
      .build()
    if (ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)) {
      published.edit { putString(sender.key, signature) }
    } else {
      Log.w("PushPortrait", "The system did not take the shortcut of a coworker")
    }
  }

  fun clear(context: Context) {
    val published = context.getSharedPreferences(PUBLISHED, Context.MODE_PRIVATE)
    ShortcutManagerCompat.removeLongLivedShortcuts(context, published.all.keys.toList())
    ShortcutManagerCompat.removeAllDynamicShortcuts(context)
    published.edit { clear() }
  }

  private fun exists(context: Context, key: String): Boolean =
    ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_DYNAMIC or ShortcutManagerCompat.FLAG_MATCH_CACHED).any { it.id == key }
}
