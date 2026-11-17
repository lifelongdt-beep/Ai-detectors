package app.examsignal.logger

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler

/**
 * 주변 블루투스(BLE) 광고 신호와 Wi-Fi 스캔 결과의 신호 세기만 수집한다.
 * 한계: 일반 폰은 연결 중인 기기의 통신 내용/트래픽은 볼 수 없고, 셀룰러(LTE/5G) 송신도 볼 수 없다.
 */
class SignalScanner(
    private val ctx: Context,
    private val handler: Handler,
    private val sink: (type: String, rawId: String, rssi: Int, extra: String) -> Unit,
) {
    private var bleScanner: BluetoothLeScanner? = null
    private var running = false
    private val wifi = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    private val bleCb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val mfg = result.scanRecord?.manufacturerSpecificData
            val mid = if (mfg != null && mfg.size() > 0) mfg.keyAt(0).toString() else ""
            sink("BLE", result.device.address, result.rssi, mid)
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
            for (r in results) onScanResult(0, r)
        }
    }

    private val wifiRx = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            readWifi()
        }
    }

    private val wifiTick = object : Runnable {
        override fun run() {
            if (!running) return
            requestWifiScan()
            handler.postDelayed(this, 20_000)
        }
    }

    @Suppress("DEPRECATION")
    private fun requestWifiScan() {
        try {
            wifi.startScan() // OS가 호출 횟수를 제한한다 (안드로이드 9+: 2분에 4회)
        } catch (e: SecurityException) {
        }
    }

    @SuppressLint("MissingPermission")
    private fun readWifi() {
        val results = try { wifi.scanResults } catch (e: SecurityException) { return }
        for (r in results) {
            val bssid = r.BSSID ?: continue
            sink("WIFI", bssid, r.level, r.frequency.toString())
        }
    }

    /** 시작 결과 메시지를 돌려준다. */
    @SuppressLint("MissingPermission")
    fun start(): String {
        if (running) return "이미 실행 중"
        val msgs = ArrayList<String>()
        val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        if (adapter == null || !adapter.isEnabled) {
            msgs.add("블루투스가 꺼져 있음 (비행기 모드에서도 블루투스는 켤 수 있음)")
        } else {
            bleScanner = adapter.bluetoothLeScanner
            val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
            bleScanner?.startScan(emptyList<ScanFilter>(), settings, bleCb)
            msgs.add("블루투스 스캔 시작")
        }
        if (!wifi.isWifiEnabled) {
            msgs.add("Wi-Fi가 꺼져 있음 (켜되 네트워크에는 연결하지 말 것)")
        } else {
            val f = IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION)
            if (Build.VERSION.SDK_INT >= 33) ctx.registerReceiver(wifiRx, f, Context.RECEIVER_NOT_EXPORTED)
            else ctx.registerReceiver(wifiRx, f)
            msgs.add("Wi-Fi 스캔 시작")
        }
        running = true
        handler.post(wifiTick)
        return msgs.joinToString(" / ")
    }

    @SuppressLint("MissingPermission")
    fun stop() {
        if (!running) return
        running = false
        handler.removeCallbacks(wifiTick)
        try { bleScanner?.stopScan(bleCb) } catch (e: Exception) { }
        try { ctx.unregisterReceiver(wifiRx) } catch (e: IllegalArgumentException) { }
    }
}
