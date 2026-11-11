package expo.modules.backgroundgrace

import android.content.Context
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowPowerManager
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26, 35])
class BackgroundGraceTest {
  private val powerManager = ApplicationProvider.getApplicationContext<Context>().getSystemService(Context.POWER_SERVICE) as PowerManager
  private val grace = BackgroundGrace(powerManager)

  @Test
  fun `begin holds a wake lock for thirty seconds`() {
    assertEquals(30.0, grace.begin(), 0.0)

    val lock = ShadowPowerManager.getLatestWakeLock()
    assertTrue(lock.isHeld)
    assertFalse(shadowOf(lock).isReferenceCounted)
    assertEquals(BackgroundGrace.WAKE_LOCK_TAG, shadowOf(lock).tag)
  }

  @Test
  fun `end releases the wake lock and reports the grace kept`() {
    grace.begin()
    val lock = ShadowPowerManager.getLatestWakeLock()

    assertTrue(grace.end())
    assertFalse(lock.isHeld)
  }

  @Test
  fun `end reports the grace lost once the thirty seconds ran out`() {
    grace.begin()
    val lock = ShadowPowerManager.getLatestWakeLock()

    ShadowSystemClock.advanceBy(Duration.ofSeconds(31))

    assertFalse(lock.isHeld)
    assertFalse(grace.end())
  }

  @Test
  fun `a new grace lets go of the one before`() {
    grace.begin()
    val first = ShadowPowerManager.getLatestWakeLock()

    grace.begin()
    val second = ShadowPowerManager.getLatestWakeLock()

    assertNotSame(first, second)
    assertFalse(first.isHeld)
    assertTrue(second.isHeld)
    assertTrue(grace.end())
  }

  @Test
  fun `end without a grace has nothing to lose`() {
    assertTrue(grace.end())
  }

  private fun shadowOf(lock: PowerManager.WakeLock) = org.robolectric.Shadows.shadowOf(lock)
}
