package expo.modules.pushportrait

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.test.core.app.ApplicationProvider
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationAction
import expo.modules.notifications.notifications.model.NotificationCategory
import expo.modules.notifications.notifications.model.NotificationContent
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.service.delegates.SharedPreferencesNotificationCategoriesStore
import java.io.File
import java.security.MessageDigest
import java.util.Date
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [30, 35])
class PortraitPresentationDelegateTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val delegate = PortraitPresentationDelegate(context)

  @After
  fun tearDown() {
    CoworkerShortcuts.clear(context)
    Portraits.clear(context)
  }

  private fun imageOf(agent: String) = "https://127.0.0.1:1/$agent"

  // As if it had been downloaded when the push came.
  private fun download(agent: String) {
    val digest = MessageDigest.getInstance("SHA-256").digest(imageOf(agent).toByteArray()).joinToString("") { "%02x".format(it) }
    val file = File(File(context.cacheDir, "push-portraits").apply { mkdirs() }, "$digest.png")
    file.outputStream().use { Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  private fun draw(agent: String?, text: String? = "Which list first?", category: String? = null, state: String = "Question"): android.app.Notification {
    val data = JSONObject("""{"workspaceId":7,"agentId":${agent?.let { "\"$it\"" }},"conversationId":"conv-1","kind":"question"}""")
    if (agent != null) data.put("sender", JSONObject().put("name", "Scout").put("image", imageOf(agent)).put("state", state))
    val content = NotificationContent.Builder().setTitle("Scout · Question").setText(text).setBody(data).setAutoDismiss(true).setCategoryId(category).build()
    return runBlocking { delegate.createNotification(Notification(NotificationRequest("id-1", content, null), Date(1_000)), null) }
  }

  private fun styleOf(notification: android.app.Notification) = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)

  private fun shortcuts() = ShortcutManagerCompat.getShortcuts(context, ShortcutManagerCompat.FLAG_MATCH_DYNAMIC)

  @Test
  fun drawsAConversationWithThePortraitOfItsCoworker() {
    download("agent-1")
    val notification = draw("agent-1")

    val message = styleOf(notification)!!.messages.single()
    assertEquals("Question · Which list first?", message.text)
    assertEquals("Scout", message.person!!.name)
    assertNotNull(message.person!!.icon)
    assertEquals("coworker-7-agent-1", NotificationCompat.getShortcutId(notification))
    val shortcut = shortcuts().single()
    assertEquals("Scout", shortcut.shortLabel)
    assertEquals("rerun://chat/general?to=agent-1&workspace=7", shortcut.intent.dataString)
  }

  @Test
  fun saysNothingBeforeTheTextOfAReceipt() {
    download("agent-1")
    assertEquals("Approved. Scout is on it.", styleOf(draw("agent-1", text = "Approved. Scout is on it.", state = ""))!!.messages.single().text)
  }

  @Test
  fun putsTheStateUnderTheNameWhenThereIsNoText() {
    download("agent-1")
    val message = styleOf(draw("agent-1", text = null))!!.messages.single()
    assertEquals("Scout", message.person!!.name)
    assertEquals("Question", message.text)
  }

  @Test
  fun keepsTheTapTheButtonsAndTheDataOfTheNotificationItIsBuiltOver() {
    download("agent-1")
    val category = NotificationCategory("rerun.question", listOf(NotificationAction("reply", "Answer", false)))
    SharedPreferencesNotificationCategoriesStore(context).saveNotificationCategory(category)
    val notification = draw("agent-1", category = "rerun.question")

    assertNotNull(notification.contentIntent)
    assertEquals(listOf("Answer"), notification.actions.map { it.title.toString() })
    assertEquals("agent-1", JSONObject(notification.extras.getString("body")!!).getString("agentId"))
    assertNotNull(notification.extras.getByteArray("expo.notification_request"))
    assertEquals(android.app.Notification.FLAG_AUTO_CANCEL, notification.flags and android.app.Notification.FLAG_AUTO_CANCEL)
  }

  @Test
  fun showsAPushOfNoCoworkerOrWithoutItsPortraitAsItWas() {
    val noCoworker = draw(null)
    val noPortrait = draw("agent-2")
    for (notification in listOf(noCoworker, noPortrait)) {
      assertNull(styleOf(notification))
      assertEquals("Scout · Question", NotificationCompat.getContentTitle(notification).toString())
    }
    assertEquals(0, shortcuts().size)
  }

  @Test
  fun keepsOneShortcutPerCoworkerAndForgetsThemAll() {
    download("agent-1")
    download("agent-3")
    draw("agent-1")
    draw("agent-1")
    draw("agent-3")
    assertEquals(setOf("coworker-7-agent-1", "coworker-7-agent-3"), shortcuts().map { it.id }.toSet())

    CoworkerShortcuts.clear(context)
    assertEquals(0, shortcuts().size)
  }

  @Test
  fun replacesAShortcutPublishedWithoutItsWorkspace() {
    download("agent-1")
    val older = PushSender("coworker-7-agent-1", "Scout", imageOf("agent-1"), "Question", "rerun://chat/general?to=agent-1")
    CoworkerShortcuts.publish(context, older, Person.Builder().setName("Scout").build(), IconCompat.createWithAdaptiveBitmap(Portraits.cached(context, older.image)!!))
    assertEquals(older.url, shortcuts().single().intent.dataString)

    draw("agent-1")
    assertEquals("rerun://chat/general?to=agent-1&workspace=7", shortcuts().single().intent.dataString)
  }
}
