package expo.modules.composerpaste

import android.view.ActionMode
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.TextView

// The floating Paste menu closes when the text changes. An image taken as an attachment changes no
// text, so the menu would stay over the composer and paste the image again: the tracker keeps the
// menu the text field opened, for the receiver to close it.
class PasteMenuTracker(private val original: ActionMode.Callback?) : ActionMode.Callback {
  private var openMenu: ActionMode? = null

  override fun onCreateActionMode(mode: ActionMode, menu: Menu): Boolean {
    val shown = original?.onCreateActionMode(mode, menu) ?: true
    if (shown) openMenu = mode
    return shown
  }

  override fun onPrepareActionMode(mode: ActionMode, menu: Menu): Boolean = original?.onPrepareActionMode(mode, menu) ?: false

  override fun onActionItemClicked(mode: ActionMode, item: MenuItem): Boolean = original?.onActionItemClicked(mode, item) ?: false

  override fun onDestroyActionMode(mode: ActionMode) {
    if (openMenu === mode) openMenu = null
    original?.onDestroyActionMode(mode)
  }

  fun close() {
    openMenu?.finish()
  }

  companion object {
    fun install(view: TextView) {
      if (view.customInsertionActionModeCallback is PasteMenuTracker) return
      val tracker = PasteMenuTracker(view.customInsertionActionModeCallback)
      view.customInsertionActionModeCallback = tracker
      view.customSelectionActionModeCallback = tracker
    }

    fun close(view: View) {
      ((view as? TextView)?.customInsertionActionModeCallback as? PasteMenuTracker)?.close()
    }
  }
}
