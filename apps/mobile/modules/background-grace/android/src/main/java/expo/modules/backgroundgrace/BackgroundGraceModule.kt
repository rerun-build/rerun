package expo.modules.backgroundgrace

import android.content.Context
import android.os.PowerManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundGraceModule : Module() {
  private val graceHolder = lazy {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    BackgroundGrace(context.getSystemService(Context.POWER_SERVICE) as PowerManager)
  }
  private val grace by graceHolder

  override fun definition() = ModuleDefinition {
    Name("BackgroundGrace")

    AsyncFunction("begin") { grace.begin() }

    AsyncFunction("end") { grace.end() }

    OnDestroy {
      if (graceHolder.isInitialized()) grace.end()
    }
  }
}
