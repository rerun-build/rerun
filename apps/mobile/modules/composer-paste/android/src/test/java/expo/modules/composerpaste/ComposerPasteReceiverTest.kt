package expo.modules.composerpaste

import android.content.ClipData
import android.content.ClipDescription
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.widget.EditText
import android.widget.FrameLayout
import androidx.core.view.ContentInfoCompat
import androidx.core.view.ViewCompat
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [26, 35])
class ComposerPasteReceiverTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val folder = File(context.cacheDir, ComposerPasteReceiver.FOLDER)
  private val emitted = mutableListOf<List<String>>()
  private val receiver = ComposerPasteReceiver(folder) { emitted += it }
  private val composer = EditText(context)

  @Before
  fun setUp() {
    folder.deleteRecursively()
    Robolectric.setupContentProvider(TestImageProvider::class.java, TestImageProvider.AUTHORITY)
    receiver.listening = true
  }

  @Test
  fun `an image from the clipboard becomes one JPEG in the cache and one event`() {
    val payload = payloadOf(ClipData("image", arrayOf("image/png"), ClipData.Item(imageUri(Color.RED))))

    val remaining = receiver.onReceiveContent(composer, payload)

    assertNull(remaining)
    assertEquals(1, emitted.size)
    assertEquals(1, emitted[0].size)
    val file = File(Uri.parse(emitted[0][0]).path!!)
    assertEquals(folder, file.parentFile)
    assertTrue(file.name.endsWith(".jpg"))
    assertArrayEquals(byteArrayOf(0xFF.toByte(), 0xD8.toByte()), file.readBytes().copyOfRange(0, 2))
    val decoded = BitmapFactory.decodeFile(file.path)
    assertEquals(IMAGE_SIZE, decoded.width)
    assertEquals(IMAGE_SIZE, decoded.height)
  }

  @Test
  fun `an image from the keyboard takes the same path`() {
    val clip = ClipData("sticker", arrayOf("image/png"), ClipData.Item(imageUri(Color.BLUE)))
    val payload = ContentInfoCompat.Builder(clip, ContentInfoCompat.SOURCE_INPUT_METHOD).build()

    assertNull(receiver.onReceiveContent(composer, payload))
    assertEquals(1, emitted.size)
  }

  @Test
  fun `text alone goes back to the default handler and emits nothing`() {
    val payload = payloadOf(ClipData.newPlainText("text", "hello"))

    val remaining = receiver.onReceiveContent(composer, payload)

    assertSame(payload, remaining)
    assertTrue(emitted.isEmpty())
    assertFalse(folder.exists())
  }

  @Test
  fun `the text next to an image is pasted as usual`() {
    val clip = ClipData("mixed", arrayOf("image/png", ClipDescription.MIMETYPE_TEXT_PLAIN), ClipData.Item(imageUri(Color.GREEN)))
    clip.addItem(ClipData.Item("caption"))

    val remaining = receiver.onReceiveContent(composer, payloadOf(clip))

    assertEquals(1, emitted.single().size)
    assertEquals(1, remaining!!.clip.itemCount)
    assertEquals("caption", remaining.clip.getItemAt(0).text)
  }

  @Test
  fun `every image of a clip is written`() {
    val clip = ClipData("images", arrayOf("image/png"), ClipData.Item(imageUri(Color.RED)))
    clip.addItem(ClipData.Item(imageUri(Color.BLUE)))

    assertNull(receiver.onReceiveContent(composer, payloadOf(clip)))
    assertEquals(2, emitted.single().size)
    assertEquals(2, folder.listFiles()!!.size)
  }

  @Test
  fun `an image is dropped while JS does not listen`() {
    receiver.listening = false
    val payload = payloadOf(ClipData("image", arrayOf("image/png"), ClipData.Item(imageUri(Color.RED))))

    assertNull(receiver.onReceiveContent(composer, payload))
    assertTrue(emitted.isEmpty())
    assertFalse(folder.exists())
  }

  @Test
  fun `a transparent sticker is flattened on white`() {
    val payload = payloadOf(ClipData("sticker", arrayOf("image/png"), ClipData.Item(imageUri(Color.TRANSPARENT))))

    receiver.onReceiveContent(composer, payload)

    val decoded = BitmapFactory.decodeFile(Uri.parse(emitted.single().single()).path!!)
    val pixel = decoded.getPixel(IMAGE_SIZE / 2, IMAGE_SIZE / 2)
    assertTrue(Color.red(pixel) > 250 && Color.green(pixel) > 250 && Color.blue(pixel) > 250)
  }

  @Test
  fun `an image that cannot be read emits nothing`() {
    val missing = Uri.parse("content://${TestImageProvider.AUTHORITY}/missing.png")
    val payload = payloadOf(ClipData("image", arrayOf("image/png"), ClipData.Item(missing)))

    assertNull(receiver.onReceiveContent(composer, payload))
    assertTrue(emitted.isEmpty())
  }

  @Test
  fun `only the composer's text field takes images`() {
    val wrapper = FrameLayout(context)
    val nested = EditText(context)
    wrapper.addView(nested)
    wrapper.setTag(com.facebook.react.R.id.react_test_id, ComposerPasteReceiver.COMPOSER_TEST_ID)
    composer.setTag(com.facebook.react.R.id.react_test_id, ComposerPasteReceiver.COMPOSER_TEST_ID)
    val other = EditText(context).apply { setTag(com.facebook.react.R.id.react_test_id, "search-input") }

    listOf(composer, nested, other).forEach { ComposerPasteReceiver.installIfComposer(it, receiver) }

    assertArrayEquals(arrayOf(ComposerPasteReceiver.IMAGE_MIME_TYPE), ViewCompat.getOnReceiveContentMimeTypes(composer))
    assertArrayEquals(arrayOf(ComposerPasteReceiver.IMAGE_MIME_TYPE), ViewCompat.getOnReceiveContentMimeTypes(nested))
    assertNull(ViewCompat.getOnReceiveContentMimeTypes(other))
  }

  private fun payloadOf(clip: ClipData) = ContentInfoCompat.Builder(clip, ContentInfoCompat.SOURCE_CLIPBOARD).build()

  private fun imageUri(color: Int): Uri {
    val bitmap = Bitmap.createBitmap(IMAGE_SIZE, IMAGE_SIZE, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
    val file = File.createTempFile("source", ".png", context.filesDir)
    file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    return Uri.parse("content://${TestImageProvider.AUTHORITY}/${file.name}")
  }

  class TestImageProvider : ContentProvider() {
    override fun onCreate() = true

    override fun getType(uri: Uri) = "image/png"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
      ParcelFileDescriptor.open(File(context!!.filesDir, uri.lastPathSegment!!), ParcelFileDescriptor.MODE_READ_ONLY)

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    companion object {
      const val AUTHORITY = "build.rerun.test.images"
    }
  }

  companion object {
    private const val IMAGE_SIZE = 64
  }
}
