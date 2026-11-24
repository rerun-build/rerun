package expo.modules.pushportrait

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Rect
import android.util.Log
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// The portraits already downloaded, one file per address: an address names one look, so it never goes stale.
internal object Portraits {
  private const val CONNECT_TIMEOUT_MS = 4000
  // A picture nobody asked for yet is drawn on the spot.
  private const val READ_TIMEOUT_MS = 10000
  private const val MAX_BYTES = 1_000_000
  // An adaptive icon shows the middle two thirds of its picture.
  private const val ADAPTIVE_BLEED = 1.5f

  private fun folder(context: Context) = File(context.cacheDir, "push-portraits")

  private fun file(context: Context, image: String): File {
    val digest = MessageDigest.getInstance("SHA-256").digest(image.toByteArray())
    return File(folder(context), digest.joinToString("") { "%02x".format(it) } + ".png")
  }

  fun cached(context: Context, image: String): Bitmap? = file(context, image).takeIf { it.exists() }?.let { BitmapFactory.decodeFile(it.path) }

  // Blocks: called from a background thread only. A portrait that cannot be had costs the push nothing else.
  fun fetch(context: Context, image: String): Bitmap? = cached(context, image) ?: try {
    val bytes = download(image)
    val portrait = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    if (portrait != null) keep(file(context, image), bytes)
    portrait
  } catch (error: Exception) {
    Log.w("PushPortrait", "A portrait was not downloaded", error)
    null
  }

  fun clear(context: Context) {
    folder(context).deleteRecursively()
  }

  private fun download(image: String): ByteArray {
    val connection = URL(image).openConnection() as HttpURLConnection
    connection.connectTimeout = CONNECT_TIMEOUT_MS
    connection.readTimeout = READ_TIMEOUT_MS
    try {
      check(connection.responseCode == HttpURLConnection.HTTP_OK) { "The portrait answered ${connection.responseCode}" }
      val bytes = connection.inputStream.use { it.readNBytesUpTo(MAX_BYTES + 1) }
      check(bytes.size <= MAX_BYTES) { "The portrait is too heavy" }
      return bytes
    } finally {
      connection.disconnect()
    }
  }

  private fun java.io.InputStream.readNBytesUpTo(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (out.size() < limit) {
      val read = read(buffer, 0, minOf(buffer.size, limit - out.size()))
      if (read < 0) break
      out.write(buffer, 0, read)
    }
    return out.toByteArray()
  }

  // Written aside then renamed: a process killed midway must not leave half a picture behind.
  private fun keep(target: File, bytes: ByteArray) {
    target.parentFile?.mkdirs()
    val partial = File.createTempFile("portrait", null, target.parentFile)
    partial.writeBytes(bytes)
    if (!partial.renameTo(target)) partial.delete()
  }

  // The portrait with the margin an adaptive icon crops, in the portrait's own background.
  fun adaptive(portrait: Bitmap): Bitmap {
    val side = (maxOf(portrait.width, portrait.height) * ADAPTIVE_BLEED).toInt()
    val left = (side - portrait.width) / 2
    val top = (side - portrait.height) / 2
    val icon = Bitmap.createBitmap(side, side, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(icon)
    canvas.drawColor(portrait.getPixel(0, 0))
    canvas.drawBitmap(portrait, null, Rect(left, top, left + portrait.width, top + portrait.height), null)
    return icon
  }
}
