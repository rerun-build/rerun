package expo.modules.composerpaste

import android.content.ClipData
import android.content.Context
import android.view.ActionMode
import android.view.Menu
import android.view.MenuInflater
import android.view.MenuItem
import android.view.View
import android.widget.EditText
import android.widget.PopupMenu
import androidx.core.view.ContentInfoCompat
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26, 35])
class PasteMenuTrackerTest {
  private val context: Context = ApplicationProvider.getApplicationContext()
  private val composer = EditText(context).apply { setTag(com.facebook.react.R.id.react_test_id, ComposerPasteReceiver.COMPOSER_TEST_ID) }
  private val receiver = ComposerPasteReceiver(File(context.cacheDir, ComposerPasteReceiver.FOLDER)) {}
  private val menu: Menu = PopupMenu(context, composer).menu
  private val reactNativeCallback = RecordingCallback()

  @Test
  fun `the menu React Native opens is kept and closed once an image is taken`() {
    composer.customInsertionActionModeCallback = reactNativeCallback
    composer.customSelectionActionModeCallback = reactNativeCallback
    ComposerPasteReceiver.installIfComposer(composer, receiver)
    val pasteMenu = FakeActionMode()

    assertTrue(composer.customInsertionActionModeCallback!!.onCreateActionMode(pasteMenu, menu))
    receiver.onReceiveContent(composer, imagePayload())

    assertTrue(pasteMenu.finished)
    assertEquals(listOf("create", "destroy"), reactNativeCallback.calls)
  }

  @Test
  fun `a text paste leaves the menu to the text field`() {
    ComposerPasteReceiver.installIfComposer(composer, receiver)
    val pasteMenu = FakeActionMode()
    composer.customInsertionActionModeCallback!!.onCreateActionMode(pasteMenu, menu)

    receiver.onReceiveContent(composer, ContentInfoCompat.Builder(ClipData.newPlainText("text", "hello"), ContentInfoCompat.SOURCE_CLIPBOARD).build())

    assertFalse(pasteMenu.finished)
  }

  @Test
  fun `a menu React Native refuses to show is not kept`() {
    reactNativeCallback.shows = false
    composer.customInsertionActionModeCallback = reactNativeCallback
    ComposerPasteReceiver.installIfComposer(composer, receiver)
    val hiddenMenu = FakeActionMode()

    assertFalse(composer.customInsertionActionModeCallback!!.onCreateActionMode(hiddenMenu, menu))
    receiver.onReceiveContent(composer, imagePayload())

    assertFalse(hiddenMenu.finished)
  }

  @Test
  fun `installing twice wraps React Native's callback once`() {
    composer.customInsertionActionModeCallback = reactNativeCallback
    ComposerPasteReceiver.installIfComposer(composer, receiver)
    val tracker = composer.customInsertionActionModeCallback

    ComposerPasteReceiver.installIfComposer(composer, receiver)

    assertSame(tracker, composer.customInsertionActionModeCallback)
    assertSame(tracker, composer.customSelectionActionModeCallback)
  }

  private fun imagePayload(): ContentInfoCompat {
    val clip = ClipData("image", arrayOf("image/png"), ClipData.Item(android.net.Uri.parse("content://build.rerun.test.none/image.png")))
    return ContentInfoCompat.Builder(clip, ContentInfoCompat.SOURCE_CLIPBOARD).build()
  }

  private inner class FakeActionMode : ActionMode() {
    var finished = false

    override fun finish() {
      finished = true
      composer.customInsertionActionModeCallback?.onDestroyActionMode(this)
    }

    override fun setTitle(title: CharSequence?) = Unit
    override fun setTitle(resId: Int) = Unit
    override fun setSubtitle(subtitle: CharSequence?) = Unit
    override fun setSubtitle(resId: Int) = Unit
    override fun setCustomView(view: View?) = Unit
    override fun invalidate() = Unit
    override fun getMenu(): Menu = menu
    override fun getTitle(): CharSequence? = null
    override fun getSubtitle(): CharSequence? = null
    override fun getCustomView(): View? = null
    override fun getMenuInflater(): MenuInflater = MenuInflater(context)
  }

  class RecordingCallback : ActionMode.Callback {
    var shows = true
    val calls = mutableListOf<String>()

    override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
      calls += "create"
      return shows
    }

    override fun onPrepareActionMode(mode: ActionMode, menu: Menu) = true

    override fun onActionItemClicked(mode: ActionMode, item: MenuItem) = false

    override fun onDestroyActionMode(mode: ActionMode) {
      calls += "destroy"
    }
  }
}
