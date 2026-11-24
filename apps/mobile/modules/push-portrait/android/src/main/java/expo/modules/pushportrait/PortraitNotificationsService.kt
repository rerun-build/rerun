package expo.modules.pushportrait

import android.content.Context
import expo.modules.notifications.service.NotificationsService
import expo.modules.notifications.service.interfaces.PresentationDelegate

class PortraitNotificationsService : NotificationsService() {
  override fun getPresentationDelegate(context: Context): PresentationDelegate = PortraitPresentationDelegate(context)
}
