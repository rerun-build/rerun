package expo.modules.composerpaste

import android.app.Activity
import android.view.View
import android.view.ViewTreeObserver
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.lang.ref.WeakReference

// The composer's EditText receives what the clipboard's Paste, the keyboard (Gboard's images and
// stickers) or a drop hands it. In the composer, and only there, the images become JPEG files handed
// to JS, to become attachments; the text next to them, if any, is pasted as usual.
class ComposerPasteModule : Module() {
  private val receiver by lazy {
    ComposerPasteReceiver(File(appContext.cacheDirectory, ComposerPasteReceiver.FOLDER)) { uris ->
      sendEvent(PASTE_IMAGES_EVENT, mapOf("uris" to uris))
    }
  }
  private var watchedRoot: WeakReference<View>? = null
  private val installOnFocus = ViewTreeObserver.OnGlobalFocusChangeListener { _, focused ->
    focused?.let { ComposerPasteReceiver.installIfComposer(it, receiver) }
  }

  override fun definition() = ModuleDefinition {
    Name("ComposerPaste")

    Events(PASTE_IMAGES_EVENT)

    OnStartObserving(PASTE_IMAGES_EVENT) {
      receiver.listening = true
      val activity = appContext.currentActivity ?: return@OnStartObserving
      activity.runOnUiThread { watch(activity) }
    }

    OnStopObserving(PASTE_IMAGES_EVENT) {
      receiver.listening = false
    }

    OnDestroy {
      val root = watchedRoot?.get() ?: return@OnDestroy
      root.post { root.viewTreeObserver.removeOnGlobalFocusChangeListener(installOnFocus) }
    }
  }

  // JS starts listening once the composer already has the focus, so the focused view is checked at
  // once; the focus listener covers a neighbour composer of the pager focused while JS still listens.
  private fun watch(activity: Activity) {
    activity.currentFocus?.let { ComposerPasteReceiver.installIfComposer(it, receiver) }
    val root = activity.window?.decorView ?: return
    if (watchedRoot?.get() === root) return
    watchedRoot?.get()?.viewTreeObserver?.removeOnGlobalFocusChangeListener(installOnFocus)
    root.viewTreeObserver.addOnGlobalFocusChangeListener(installOnFocus)
    watchedRoot = WeakReference(root)
  }

  companion object {
    const val PASTE_IMAGES_EVENT = "onPasteImages"
  }
}
