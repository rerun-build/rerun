package expo.modules.composerpaste

import android.content.ClipData
import android.content.ClipDescription
import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.EditText
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID

class ComposerPasteReceiver(
  private val folder: File,
  private val onImages: (List<String>) -> Unit
) : OnReceiveContentListener {
  @Volatile
  var listening = false

  // An image never lands in the composer as its content:// address: written and handed to JS while
  // JS listens, dropped otherwise, as iOS ignores an image pasted where nothing takes it.
  override fun onReceiveContent(view: View, payload: ContentInfoCompat): ContentInfoCompat? {
    val resolver = view.context.contentResolver
    val description = payload.clip.description
    val split = payload.partition { item -> isImage(item, description, resolver) }
    val images = split.first ?: return payload
    if (listening) {
      val uris = (0 until images.clip.itemCount).mapNotNull { index -> writeJpeg(images.clip.getItemAt(index).uri, resolver) }
      if (uris.isNotEmpty()) onImages(uris)
    }
    PasteMenuTracker.close(view)
    return split.second
  }

  private fun isImage(item: ClipData.Item, description: ClipDescription, resolver: ContentResolver): Boolean {
    val uri = item.uri ?: return false
    val type = resolver.getType(uri) ?: return description.hasMimeType(IMAGE_MIME_TYPE)
    return ClipDescription.compareMimeTypes(type, IMAGE_MIME_TYPE)
  }

  // JPEG at the quality the photo picker uses, in the cache Android may empty: the upload reads it once.
  private fun writeJpeg(uri: Uri, resolver: ContentResolver): String? = runCatching {
    val image = flattenOnWhite(decode(uri, resolver) ?: return null)
    folder.mkdirs()
    val file = File(folder, "pasted-${UUID.randomUUID().toString().take(8)}.jpg")
    val written = file.outputStream().use { image.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
    if (!written) {
      file.delete()
      return null
    }
    Uri.fromFile(file).toString()
  }.getOrNull()

  // ImageDecoder turns the photo upright from its EXIF orientation, BitmapFactory does not.
  private fun decode(uri: Uri, resolver: ContentResolver): Bitmap? {
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      return ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, _, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
      }
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
  }

  // JPEG has no alpha: a transparent sticker would turn black.
  private fun flattenOnWhite(bitmap: Bitmap): Bitmap {
    if (!bitmap.hasAlpha()) return bitmap
    val flat = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
    Canvas(flat).apply {
      drawColor(Color.WHITE)
      drawBitmap(bitmap, 0f, 0f, null)
    }
    return flat
  }

  companion object {
    const val FOLDER = "composer-paste"
    const val COMPOSER_TEST_ID = "composer-input"
    const val IMAGE_MIME_TYPE = "image/*"
    private const val JPEG_QUALITY = 80

    fun isComposer(view: View): Boolean =
      generateSequence(view) { it.parent as? View }.any { it.getTag(com.facebook.react.R.id.react_test_id) == COMPOSER_TEST_ID }

    fun installIfComposer(view: View, receiver: ComposerPasteReceiver) {
      if (view !is EditText || !isComposer(view)) return
      ViewCompat.setOnReceiveContentListener(view, arrayOf(IMAGE_MIME_TYPE), receiver)
      PasteMenuTracker.install(view)
    }
  }
}
