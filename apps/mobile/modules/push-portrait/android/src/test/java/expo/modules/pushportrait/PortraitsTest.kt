package expo.modules.pushportrait

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.core.app.ApplicationProvider
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import kotlin.concurrent.thread
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
@Config(sdk = [35])
class PortraitsTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val server = ServerSocket(0)
  private var requests = 0

  @After
  fun tearDown() {
    server.close()
    Portraits.clear(context)
  }

  private fun serve(status: String, body: ByteArray): String {
    thread(isDaemon = true) {
      while (!server.isClosed) {
        try {
          server.accept().use { socket ->
            val reader = socket.getInputStream().bufferedReader()
            while (!reader.readLine().isNullOrEmpty()) Unit
            requests++
            socket.getOutputStream().apply {
              write("HTTP/1.1 $status\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
              write(body)
              flush()
            }
          }
        } catch (_: Exception) {
          return@thread
        }
      }
    }
    return "http://127.0.0.1:${server.localPort}/portrait"
  }

  private fun png(): ByteArray = ByteArrayOutputStream().also { square(16).compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()

  private fun square(side: Int) = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }

  @Test
  fun downloadsAPortraitOnceAndKeepsIt() {
    val url = serve("200 OK", png())
    assertNull(Portraits.cached(context, url))
    assertEquals(16, Portraits.fetch(context, url)!!.width)
    assertNotNull(Portraits.cached(context, url))
    Portraits.fetch(context, url)
    assertEquals(1, requests)
  }

  @Test
  fun goesWithoutAPortraitTheHubCannotDraw() {
    val url = serve("502 Bad Gateway", png())
    assertNull(Portraits.fetch(context, url))
    assertNull(Portraits.cached(context, url))
  }

  @Test
  fun goesWithoutAPortraitThatIsNoPicture() {
    val url = serve("200 OK", "<html>".toByteArray())
    assertNull(Portraits.fetch(context, url))
    assertNull(Portraits.cached(context, url))
  }

  @Test
  fun goesWithoutAPortraitNobodyServes() {
    val url = "http://127.0.0.1:${server.localPort}/portrait"
    server.close()
    assertNull(Portraits.fetch(context, url))
  }

  @Test
  fun leavesTheMarginAnAdaptiveIconCropsInTheColourOfThePortrait() {
    val icon = Portraits.adaptive(square(100))
    assertEquals(150, icon.width)
    assertEquals(Color.RED, icon.getPixel(0, 0))
  }
}
