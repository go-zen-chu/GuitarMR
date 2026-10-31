package xyz.amasuda.tky

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.text.InputType
import android.util.Log
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.Toast
import java.io.IOException

/**
 * Runs the phone page (web/packages/demo, built for Android) in a WebView and
 * gives it what a browser tab lacks here: file and camera pickers, saving
 * through Android's file picker, and Claude reading with the user's own key.
 */
class MainActivity : Activity(), PageHost {

    private lateinit var webView: WebView
    private lateinit var keys: ApiKeyStore
    private val pageAssets = PageAssets()

    private var pendingChooser: ValueCallback<Array<Uri>>? = null
    private var pendingPhoto: Uri? = null
    private var pendingSave: PendingSave? = null

    private class PendingSave(val data: String, val onResult: (SaveOutcome) -> Unit)

    /** Sets up the page and the key shortcut, then opens the key dialog if launched from that shortcut. */
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Practice: the play view scrolls on its own while both hands are on the guitar.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        keys = PreferencesApiKeyStore(getSharedPreferences("tky", MODE_PRIVATE))

        webView = WebView(this)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
        }
        webView.webViewClient = PageClient()
        webView.webChromeClient = ChooserClient()
        val page = PageCallback { callId, error, value ->
            runOnUiThread { webView.evaluateJavascript(settleScript(callId, error, value), null) }
        }
        webView.addJavascriptInterface(HostBridge(keys, this, page), "GuitarMRAndroid")
        // Android 15 draws apps edge to edge: keep the page clear of the status, navigation and keyboard areas.
        // Older versions lay the window out inside the bars already.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            webView.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                WindowInsets.CONSUMED
            }
        }
        setContentView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        if (savedInstanceState == null) webView.loadUrl(PAGE_URL) else webView.restoreState(savedInstanceState)
        publishKeyShortcut()
        handleIntent(intent)
    }

    /** Opens the key dialog when the running app is reached from the key shortcut. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Keeps the page's place across a recreated activity. */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** Releases the page's WebView with the activity. */
    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    /** Acts on what the app was opened for. */
    private fun handleIntent(intent: Intent?) {
        if (intent?.action == ACTION_API_KEY) showKeySettings()
    }

    /** A launcher shortcut to change or remove the key (the page asks for one only when it has none). */
    private fun publishKeyShortcut() {
        val shortcut = ShortcutInfo.Builder(this, "api-key")
            .setShortLabel(getString(R.string.shortcut_api_key))
            .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
            .setIntent(Intent(ACTION_API_KEY, null, this, MainActivity::class.java))
            .build()
        runCatching { getSystemService(ShortcutManager::class.java)?.dynamicShortcuts = listOf(shortcut) }
            .onFailure { Log.w(TAG, "could not publish the API key shortcut", it) }
    }

    /** Asks for a key on the page's behalf; [onResult] gets "" when the user cancels. */
    override fun askApiKey(onResult: (String) -> Unit) {
        runOnUiThread { showKeyDialog(withForget = false, onResult = onResult) }
    }

    /** The key dialog from the shortcut: change the key, or remove it. */
    private fun showKeySettings() {
        showKeyDialog(withForget = keys.apiKey().isNotEmpty()) { key ->
            if (key.isNotEmpty()) Toast.makeText(this, R.string.api_key_saved, Toast.LENGTH_SHORT).show()
        }
    }

    /** Asks for a key and stores it once it looks right; [onResult] gets the key, or "" when none was stored. */
    private fun showKeyDialog(withForget: Boolean, onResult: (String) -> Unit) {
        val input = EditText(this).apply {
            hint = getString(R.string.api_key_hint)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            isSingleLine = true
        }
        val container = FrameLayout(this).apply {
            val gutter = (20 * resources.displayMetrics.density).toInt()
            setPadding(gutter, 0, gutter, 0)
            addView(input)
        }
        var answered = false
        val answer = { key: String ->
            if (!answered) {
                answered = true
                onResult(key)
            }
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.api_key_title)
            .setMessage(R.string.api_key_message)
            .setView(container)
            .setPositiveButton(R.string.api_key_save, null)
            .setNegativeButton(R.string.cancel) { _, _ -> answer("") }
            .setOnCancelListener { answer("") }
            .apply {
                if (withForget) {
                    setNeutralButton(R.string.api_key_forget) { _, _ ->
                        keys.forgetApiKey()
                        Toast.makeText(this@MainActivity, R.string.api_key_forgotten, Toast.LENGTH_SHORT).show()
                        answer("")
                    }
                }
            }
            .create()
        dialog.setOnShowListener {
            // Set here rather than in the builder so a key that does not look right keeps the dialog open.
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val key = ApiKeys.normalize(input.text.toString())
                if (key == null) {
                    input.error = getString(R.string.api_key_hint)
                    return@setOnClickListener
                }
                keys.saveApiKey(key)
                dialog.dismiss()
                answer(key)
            }
        }
        dialog.show()
    }

    /** Lets the user pick where the page's file goes, then writes it there. */
    override fun save(filename: String, mimeType: String, data: String, onResult: (SaveOutcome) -> Unit) {
        runOnUiThread {
            pendingSave?.onResult?.invoke(SaveOutcome.DECLINED)
            pendingSave = PendingSave(data, onResult)
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(mimeType)
                .putExtra(Intent.EXTRA_TITLE, filename)
            if (!start(intent, REQUEST_SAVE)) finishSave(null)
        }
    }

    /** Writes the pending save to [target], or declines it when the user picked nothing. */
    private fun finishSave(target: Uri?) {
        val save = pendingSave ?: return
        pendingSave = null
        if (target == null) {
            save.onResult(SaveOutcome.DECLINED)
            return
        }
        Thread {
            val outcome = try {
                contentResolver.openOutputStream(target, "wt")?.use { it.write(save.data.toByteArray()) }
                    ?: throw IOException("no output stream for $target")
                SaveOutcome.SAVED
            } catch (e: IOException) {
                Log.w(TAG, "could not save the file", e)
                SaveOutcome.FAILED
            } catch (e: SecurityException) {
                Log.w(TAG, "could not save the file", e)
                SaveOutcome.FAILED
            }
            save.onResult(outcome)
        }.start()
    }

    /** Hands each picker's answer to whoever asked for it: the page's file input or a save. */
    @Deprecated("Activity result APIs need androidx; the platform callback is all this app uses.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        when (requestCode) {
            REQUEST_OPEN -> finishChooser(if (resultCode == RESULT_OK) urisOf(data) else null)
            REQUEST_PHOTO -> {
                val photo = pendingPhoto
                pendingPhoto = null
                if (resultCode != RESULT_OK && photo != null) contentResolver.delete(photo, null, null)
                finishChooser(if (resultCode == RESULT_OK && photo != null) arrayOf(photo) else null)
            }
            REQUEST_SAVE -> finishSave(if (resultCode == RESULT_OK) data?.data else null)
            else -> @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        }
    }

    /** The files a document picker returned (one, or several with multiple selection). */
    private fun urisOf(data: Intent?): Array<Uri>? {
        val clip = data?.clipData
        if (clip != null) return Array(clip.itemCount) { clip.getItemAt(it).uri }
        return data?.data?.let { arrayOf(it) }
    }

    /** Gives the page's file input its files, or nothing when the picker was cancelled. */
    private fun finishChooser(uris: Array<Uri>?) {
        pendingChooser?.onReceiveValue(uris)
        pendingChooser = null
    }

    /** Starts a picker; false when no app on the device handles it. */
    private fun start(intent: Intent, requestCode: Int): Boolean = try {
        @Suppress("DEPRECATION")
        startActivityForResult(intent, requestCode)
        true
    } catch (e: ActivityNotFoundException) {
        Log.w(TAG, "no app for $intent", e)
        false
    }

    /** A new photo in Pictures/tky for the camera app to write. */
    private fun newPhotoUri(): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "tky-${System.currentTimeMillis()}.jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/tky")
        }
        return contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
    }

    /** Serves the bundled page and keeps outside links out of the app. */
    private inner class PageClient : WebViewClient() {
        /** The bundled file for the page's own URLs; everything else goes to the network. */
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val asset = pageAssets.resolve(request.url.toString()) ?: return null
            return try {
                WebResourceResponse(asset.mimeType, "utf-8", assets.open(asset.path))
            } catch (e: IOException) {
                Log.d(TAG, "no bundled file for ${request.url}: ${e.message}")
                WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)
            }
        }

        /** Opens links away from the page in the browser instead of inside the app. */
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (pageAssets.isPageUrl(request.url.toString())) return false
            try {
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
            } catch (e: ActivityNotFoundException) {
                Toast.makeText(this@MainActivity, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
            }
            return true
        }
    }

    /** Answers the page's `<input type="file">`: the camera app for `capture`, the document picker otherwise. */
    private inner class ChooserClient : WebChromeClient() {
        /** Opens the matching picker and answers [callback] when it returns. */
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            pendingChooser?.onReceiveValue(null)
            pendingChooser = callback
            if (capturesPhoto(params.isCaptureEnabled, params.acceptTypes)) {
                val photo = newPhotoUri()
                if (photo != null) {
                    pendingPhoto = photo
                    val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, photo)
                    if (start(intent, REQUEST_PHOTO)) return true
                    pendingPhoto = null
                    contentResolver.delete(photo, null, null)
                }
            }
            val types = chooserMimeTypes(params.acceptTypes)
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(types.singleOrNull() ?: "*/*")
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            if (types.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
            if (!start(intent, REQUEST_OPEN)) finishChooser(null)
            return true
        }
    }

    private companion object {
        const val TAG = "tky"
        const val ACTION_API_KEY = "xyz.amasuda.tky.action.API_KEY"
        const val REQUEST_OPEN = 1
        const val REQUEST_PHOTO = 2
        const val REQUEST_SAVE = 3
    }
}
