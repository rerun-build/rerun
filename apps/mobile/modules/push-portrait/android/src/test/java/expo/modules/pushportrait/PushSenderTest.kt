package expo.modules.pushportrait

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PushSenderTest {
  private fun push(agentId: String = "agent-1", image: String = "https://app.rerun.build/og/coworker/a", workspaceId: Int = 7) =
    """{"workspaceId":$workspaceId,"agentId":"$agentId","conversationId":null,"kind":"question","sender":{"name":"Scout","image":"$image","state":"Question"}}"""

  @Test
  fun readsTheCoworkerOfAPush() {
    val sender = PushSender.from(push())!!
    assertEquals("Scout", sender.name)
    assertEquals("Question", sender.state)
    assertEquals("rerun://chat/general?to=agent-1&workspace=7", sender.url)
  }

  @Test
  fun opensTheLastConversationOfTheChiefOfStaffAndTellsThoseOfTwoWorkspacesApart() {
    val sender = PushSender.from(push(agentId = "foreman"))!!
    assertEquals("rerun://chat/last?workspace=7", sender.url)
    assertNotEquals(sender.key, PushSender.from(push(agentId = "foreman", workspaceId = 8))!!.key)
  }

  @Test
  fun namesNoWorkspaceForAPushThatCarriesNone() {
    assertEquals("rerun://chat/general?to=agent-1", PushSender.from(push().replace("\"workspaceId\":7,", ""))!!.url)
    assertEquals("rerun://chat/last", PushSender.from(push(agentId = "foreman").replace("\"workspaceId\":7,", ""))!!.url)
  }

  @Test
  fun leavesAloneAPushOfNoCoworkerOrOneItCannotTrust() {
    assertNull(PushSender.from(null as String?))
    assertNull(PushSender.from("not json"))
    assertNull(PushSender.from("""{"agentId":"agent-1","kind":"done"}"""))
    assertNull(PushSender.from("""{"agentId":null,"sender":{"name":"Scout","image":"https://x/y","state":""}}"""))
    assertNull(PushSender.from(push(image = "http://app.rerun.build/og/coworker/a")))
    assertNull(PushSender.from(push(agentId = "../settings")))
  }
}
