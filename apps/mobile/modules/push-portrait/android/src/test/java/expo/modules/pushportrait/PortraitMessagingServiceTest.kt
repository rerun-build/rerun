package expo.modules.pushportrait

import android.content.Intent
import com.google.firebase.messaging.RemoteMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class RecordingMessagingService : PortraitMessagingService() {
  val presented = mutableListOf<RemoteMessage>()
  var onScreen = false

  override fun present(message: RemoteMessage) {
    presented += message
  }

  override fun appOnScreen() = onScreen
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26, 35])
class PortraitMessagingServiceTest {
  private val service = Robolectric.setupService(RecordingMessagingService::class.java)
  // Nothing answers on port 1: the push goes on without its portrait, at once.
  private val sender = """{"agentId":"agent-1","conversationId":"conv-1","kind":"question","sender":{"name":"Scout","image":"https://127.0.0.1:1/a","state":"Question"}}"""

  private fun push(body: String, id: String) = Intent("com.google.android.c2dm.intent.RECEIVE")
    .putExtra("google.message_id", id)
    .putExtra("gcm.n.e", "1")
    .putExtra("gcm.notification.e", "1")
    .putExtra("gcm.n.title", "Scout · Question")
    .putExtra("gcm.n.body", "Which list first?")
    .putExtra("gcm.n.android_channel_id", "messages")
    .putExtra("categoryId", "rerun.question")
    .putExtra("body", body)

  @Test
  fun drawsItselfTheCoworkersPushFirebaseWouldHaveDrawn() {
    service.handleIntent(push(sender, "m1"))

    val message = service.presented.single()
    assertNull(message.notification)
    assertEquals("Scout · Question", message.data["title"])
    assertEquals("Which list first?", message.data["message"])
    assertEquals("messages", message.data["channelId"])
    assertEquals("rerun.question", message.data["categoryId"])
    assertEquals(sender, message.data["body"])
    assertEquals("m1", message.messageId)
  }

  @Test
  fun leavesToFirebaseAPushOfNoCoworker() {
    val intent = push("""{"agentId":null,"kind":"info"}""", "m2")
    try {
      service.handleIntent(intent)
    } catch (_: RuntimeException) {
      // Firebase draws this one itself, which takes a configured app.
    }
    assertTrue(service.presented.isEmpty())
    assertEquals("1", intent.getStringExtra("gcm.n.e"))
  }

  @Test
  fun leavesAPushAloneWhileTheAppIsOnScreen() {
    service.onScreen = true
    val intent = push(sender, "m3")
    try {
      service.handleIntent(intent)
    } catch (_: RuntimeException) {
      // expo-notifications takes it from there, in an app that runs.
    }
    assertTrue(service.presented.isEmpty())
    assertEquals("1", intent.getStringExtra("gcm.n.e"))
  }

  @Test
  fun drawsOnceAPushDeliveredTwice() {
    service.handleIntent(push(sender, "m4"))
    service.handleIntent(push(sender, "m4"))
    assertEquals(1, service.presented.size)
  }
}
