package com.epixs.picok_booth

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Hosts the Flutter booth UI and implements kiosk (lock-task) mode.
 *
 * When the app is the device owner (provisioned with `adb shell dpm set-device-owner`), the lock is
 * silent and complete: no status bar, no home/recents, the app is the launcher and starts on boot.
 * Otherwise Android screen pinning is used.
 */
class MainActivity : FlutterActivity() {

    private val dpm by lazy { getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager }
    private val am by lazy { getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager }
    private val admin by lazy { ComponentName(this, KioskAdminReceiver::class.java) }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "com.epixs.picok_booth/kiosk")
            .setMethodCallHandler { call, result ->
                try {
                    when (call.method) {
                        "isDeviceOwner" -> result.success(isDeviceOwner())
                        "isLocked" -> result.success(isLocked())
                        "start" -> {
                            startKiosk()
                            result.success(null)
                        }
                        "stop" -> {
                            stopKiosk()
                            result.success(null)
                        }
                        else -> result.notImplemented()
                    }
                } catch (e: Exception) {
                    result.error("kiosk", e.message, null)
                }
            }
    }

    private fun isDeviceOwner() = dpm.isDeviceOwnerApp(packageName)

    private fun isLocked() = am.lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    private fun startKiosk() {
        if (isDeviceOwner()) {
            dpm.setLockTaskPackages(admin, arrayOf(packageName))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE)
            }
            val home = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, home, ComponentName(this, MainActivity::class.java))
            dpm.setKeyguardDisabled(admin, true)
            dpm.setStatusBarDisabled(admin, true)
            val plugged = BatteryManager.BATTERY_PLUGGED_AC or BatteryManager.BATTERY_PLUGGED_USB or
                BatteryManager.BATTERY_PLUGGED_WIRELESS
            dpm.setGlobalSetting(admin, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, plugged.toString())
        }
        if (!isLocked()) startLockTask()
    }

    private fun stopKiosk() {
        if (isLocked()) stopLockTask()
        if (isDeviceOwner()) {
            dpm.clearPackagePersistentPreferredActivities(admin, packageName)
            dpm.setStatusBarDisabled(admin, false)
            dpm.setKeyguardDisabled(admin, false)
        }
    }
}
