package expo.modules.pushportrait

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PushPortraitModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PushPortrait")

    // Whoever signs in next on this phone must not find someone else's coworkers on the app's icon.
    AsyncFunction("clear") {
      CoworkerShortcuts.clear(context)
      Portraits.clear(context)
    }
  }
}
