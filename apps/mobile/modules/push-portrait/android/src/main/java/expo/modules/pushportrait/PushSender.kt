package expo.modules.pushportrait

import org.json.JSONException
import org.json.JSONObject

// The coworker a push comes from, as the hub names it in the push's data (`pushDataSchema`).
internal data class PushSender(
  val key: String,
  val name: String,
  val image: String,
  val state: String,
  // Where its shortcut on the app's icon lands: its General, or the Chief of Staff's last conversation, in
  // the workspace it names (`shortcut-link.ts`).
  val url: String
) {
  companion object {
    private const val FOREMAN = "foreman"
    private val ROUTE_ID = Regex("""[\w-]+""")

    fun from(data: JSONObject?): PushSender? {
      val sender = data?.optJSONObject("sender") ?: return null
      val agentId = data.text("agentId")?.takeIf { ROUTE_ID.matches(it) } ?: return null
      val name = sender.text("name") ?: return null
      val image = sender.text("image")?.takeIf { it.startsWith("https://") } ?: return null
      val workspaceId = data.optLong("workspaceId")
      val page = if (agentId == FOREMAN) "last" else "general"
      val query = listOfNotNull("to=$agentId".takeIf { agentId != FOREMAN }, "workspace=$workspaceId".takeIf { workspaceId > 0 }).joinToString("&")
      return PushSender(
        // The Chief of Staff has the same id in every workspace.
        key = "coworker-$workspaceId-$agentId",
        name = name,
        image = image,
        state = sender.text("state").orEmpty(),
        url = "rerun://chat/$page" + if (query.isEmpty()) "" else "?$query"
      )
    }

    fun from(json: String?): PushSender? = try {
      json?.let { from(JSONObject(it)) }
    } catch (_: JSONException) {
      null
    }

    private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
  }
}
