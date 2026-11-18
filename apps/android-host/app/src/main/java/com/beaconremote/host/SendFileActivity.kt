package com.beaconremote.host

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Lets the person pick one file on this phone for the viewer. It shows only the system picker, then hands the chosen
 * file to the sharing service, which offers it when the viewer has file permission and sharing is live and unpaused.
 * Nothing is read until that happens, and cancelling the picker sends nothing.
 */
class SendFileActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState != null) return
        @Suppress("DEPRECATION")
        startActivityForResult(
            Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),
            REQUEST_PICK,
        )
    }

    @Deprecated("Uses the platform result API the host app already targets")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = data?.data
        if (requestCode == REQUEST_PICK && resultCode == RESULT_OK && uri != null) {
            // The picker grants read access to this app for the URI; the service reads it while sharing.
            startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_SEND_FILE).setData(uri))
        }
        finish()
    }

    companion object {
        private const val REQUEST_PICK = 4311
    }
}
