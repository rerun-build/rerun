package expo.modules.backgroundgrace

import android.os.PowerManager

// Android does not suspend an app thirty seconds after it leaves the screen the way iOS does, but the
// CPU may sleep once the screen is off. A partial wake lock bounded to the same thirty seconds keeps
// the chat stream alive for as long as iOS would, and lets go by itself if JS never calls end().
class BackgroundGrace(private val powerManager: PowerManager) {
  private var wakeLock: PowerManager.WakeLock? = null

  @Synchronized
  fun begin(): Double {
    release()
    val lock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG)
    lock.setReferenceCounted(false)
    lock.acquire(GRACE_SECONDS * 1000L)
    wakeLock = lock
    return GRACE_SECONDS.toDouble()
  }

  // False when the thirty seconds ran out first, as on iOS when the system took its time back.
  @Synchronized
  fun end(): Boolean {
    val lock = wakeLock ?: return true
    val kept = lock.isHeld
    release()
    return kept
  }

  private fun release() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
  }

  companion object {
    const val GRACE_SECONDS = 30
    const val WAKE_LOCK_TAG = "rerun:chat-stream"
  }
}
