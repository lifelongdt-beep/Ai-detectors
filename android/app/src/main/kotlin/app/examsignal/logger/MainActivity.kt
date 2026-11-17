package app.examsignal.logger

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.examsignal.logger.core.Alert
import app.examsignal.logger.core.Csv
import app.examsignal.logger.core.Detector
import app.examsignal.logger.core.Ids
import app.examsignal.logger.core.Sighting
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 시험장 신호 로거 (모의시험 실측용 프로토타입)
 *  1) 기준선 수집: 시험 전, 교실의 정상 신호(공유기, 감독관 기기 등)를 기록
 *  2) 시험 감시: 기준선에 없던 새 신호가 반복 관측되면 알림
 * 데이터는 단말 파일에만 저장된다 (인터넷 권한 없음). 시험 종료 후 USB로 회수해 분석한다.
 */
class MainActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private val detector = Detector()
    private var scanner: SignalScanner? = null
    private var writer: LogWriter? = null
    private var phase = "IDLE" // IDLE | BASE | EXAM
    private var pos = "-"
    private var startMs = 0L
    private var lines = 0
    private val uniqueIds = HashSet<String>()
    private val alerts = ArrayList<String>()

    private lateinit var observerEdit: EditText
    private lateinit var keyEdit: EditText
    private lateinit var netBanner: TextView
    private lateinit var status: TextView
    private lateinit var alertView: TextView
    private lateinit var posView: TextView
    private val posButtons = HashMap<String, Button>()

    private val permCode = 7

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(buildUi())
        handler.post(uiTick)
    }

    override fun onDestroy() {
        handler.removeCallbacks(uiTick)
        stopSession()
        super.onDestroy()
    }

    // ---------- UI ----------
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun text(s: String, sizeSp: Float = 14f, color: Int = Color.BLACK): TextView =
        TextView(this).apply { text = s; textSize = sizeSp; setTextColor(color) }

    private fun button(s: String, onClick: () -> Unit): Button =
        Button(this).apply { text = s; setOnClickListener { onClick() } }

    private fun buildUi(): ScrollView {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }
        root.addView(text("시험장 신호 로거", 22f))
        root.addView(text("모의시험 실측용 프로토타입 · 신호 세기만 기록 · 인터넷 권한 없음", 12f, Color.DKGRAY))

        netBanner = text("", 13f, Color.WHITE)
        netBanner.setPadding(dp(8), dp(6), dp(8), dp(6))
        root.addView(netBanner, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })

        root.addView(text("관측자 이름 (예: 교실1, 복도2)", 12f, Color.DKGRAY))
        observerEdit = EditText(this).apply { setText("교실1"); setSingleLine() }
        root.addView(observerEdit)
        root.addView(text("시험 세션 키 (모든 폰에 같은 값 입력, 기기 식별자 해시용)", 12f, Color.DKGRAY))
        keyEdit = EditText(this).apply { setText("mock-" + SimpleDateFormat("yyyyMMdd", Locale.US).format(Date())); setSingleLine() }
        root.addView(keyEdit)

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val w = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        row.addView(button("① 기준선 수집") { startPhase("BASE") }, w)
        row.addView(button("② 시험 감시") { startPhase("EXAM") }, w)
        row.addView(button("중지") { stopSession(); refresh() }, w)
        root.addView(row)

        posView = text("", 14f, Color.rgb(0, 90, 160))
        root.addView(posView)
        root.addView(text("현재 내 위치 (이동할 때마다 눌러 위치를 기록)", 12f, Color.DKGRAY))
        root.addView(buildPosGrid())

        status = text("", 13f)
        root.addView(status, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })

        root.addView(text("알림 (단서일 뿐 부정행위의 증거가 아닙니다)", 14f, Color.rgb(160, 40, 40)))
        alertView = text("없음", 13f)
        root.addView(alertView)

        root.addView(button("로그 파일 삭제") { confirmDelete() })
        return ScrollView(this).apply { addView(root) }
    }

    private fun buildPosGrid(): LinearLayout {
        val grid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val w = LinearLayout.LayoutParams(0, dp(42), 1f)
        for (r in 1..6) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            for (c in 1..5) row.addView(posButton("R$r-C$c"), w)
            grid.addView(row)
        }
        val extra = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (p in listOf("H1", "H2", "H3", "F", "-")) extra.addView(posButton(p), w)
        grid.addView(extra)
        grid.addView(text("R행-C열 = 좌석 (앞줄이 R1) · H1~H3 = 복도 · F = 교탁/앞 · - = 미지정", 11f, Color.GRAY))
        return grid
    }

    private fun posButton(p: String): Button {
        val b = button(p) { pos = p; refresh() }
        b.textSize = 10f
        b.setPadding(0, 0, 0, 0)
        posButtons[p] = b
        return b
    }

    private fun confirmDelete() {
        AlertDialog.Builder(this)
            .setTitle("로그 삭제")
            .setMessage("이 앱이 저장한 로그 파일을 모두 삭제합니다. 회수하지 않았다면 데이터가 사라집니다.")
            .setPositiveButton("삭제") { _, _ ->
                if (phase != "IDLE") stopSession()
                logDir().listFiles()?.forEach { it.delete() }
                refresh()
            }
            .setNegativeButton("취소", null)
            .show()
    }

    // ---------- 세션 ----------
    private fun logDir(): File = getExternalFilesDir(null) ?: filesDir

    private fun neededPermissions(): Array<String> {
        val l = ArrayList<String>()
        l.add(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 31) l.add(Manifest.permission.BLUETOOTH_SCAN)
        if (Build.VERSION.SDK_INT >= 33) l.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        return l.toTypedArray()
    }

    private fun missingPermissions(): List<String> =
        neededPermissions().filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }

    private var pendingPhase: String? = null

    private fun startPhase(p: String) {
        val missing = missingPermissions()
        if (missing.isNotEmpty()) {
            pendingPhase = p
            requestPermissions(missing.toTypedArray(), permCode)
            return
        }
        if (phase == "IDLE") beginSession()
        phase = p
        detector.baselineMode = (p == "BASE")
        refresh()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != permCode) return
        val p = pendingPhase
        pendingPhase = null
        if (missingPermissions().isEmpty() && p != null) startPhase(p)
        else status.text = "권한이 필요합니다: 위치(블루투스/Wi-Fi 스캔에 OS가 요구), 근처 기기"
    }

    private fun beginSession() {
        val observer = observerEdit.text.toString().ifBlank { "obs" }
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val file = File(logDir(), "exam-$observer-$stamp.csv")
        val wr = LogWriter(file)
        wr.writeLine("# EXAMLOG v1 observer=$observer start=${System.currentTimeMillis()} model=${Build.MODEL}")
        wr.writeLine(Csv.HEADER)
        writer = wr
        lines = 0
        uniqueIds.clear()
        startMs = System.currentTimeMillis()
        val sc = SignalScanner(this, handler) { type, raw, rssi, extra -> onSighting(type, raw, rssi, extra) }
        scanner = sc
        status.text = sc.start()
    }

    private fun stopSession() {
        scanner?.stop(); scanner = null
        writer?.close(); writer = null
        phase = "IDLE"
    }

    private fun onSighting(type: String, raw: String, rssi: Int, extra: String) {
        val wr = writer ?: return
        val now = System.currentTimeMillis()
        val id = Ids.hash(keyEdit.text.toString(), raw)
        wr.writeLine(Csv.row(now, observerEdit.text.toString(), phase, pos, type, id, rssi, extra))
        lines++
        uniqueIds.add(id)
        val alert = detector.observe(Sighting(now, type, id, rssi, pos))
        if (alert != null) onAlert(alert)
    }

    private fun onAlert(a: Alert) {
        val mm = (a.tMs - startMs) / 1000
        alerts.add(0, "[%02d:%02d] 새 신호 %s %s · %s(%d dBm) · 내 위치 %s · %d회".format(mm / 60, mm % 60, a.type, a.id, a.proximity, a.strongestRssi, a.pos, a.count))
        while (alerts.size > 8) alerts.removeAt(alerts.size - 1)
        val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        v.vibrate(VibrationEffect.createOneShot(300, VibrationEffect.DEFAULT_AMPLITUDE))
        refresh()
    }

    // ---------- 화면 갱신 ----------
    private val uiTick = object : Runnable {
        override fun run() {
            refresh()
            writer?.flush()
            handler.postDelayed(this, 1000)
        }
    }

    private fun networkWarning(): String? {
        val airplane = Settings.Global.getInt(contentResolver, Settings.Global.AIRPLANE_MODE_ON, 0) == 1
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork)
        val online = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        return when {
            online -> "⚠ 네트워크에 연결된 상태입니다. 감독관 폰은 외부 통신 금지 → 비행기 모드를 켜고 Wi-Fi/블루투스만 수신용으로 켜세요."
            !airplane -> "⚠ 비행기 모드가 꺼져 있습니다. 시험 중에는 켜 두세요 (Wi-Fi/블루투스는 따로 켤 수 있음)."
            else -> null
        }
    }

    private fun refresh() {
        val warn = networkWarning()
        netBanner.text = warn ?: "✓ 비행기 모드 · 외부 네트워크 미연결"
        netBanner.setBackgroundColor(if (warn != null) Color.rgb(190, 50, 50) else Color.rgb(40, 140, 80))
        posView.text = "현재 위치: $pos"
        for ((p, b) in posButtons) b.setBackgroundColor(if (p == pos) Color.rgb(120, 170, 235) else Color.LTGRAY)
        val label = when (phase) { "BASE" -> "기준선 수집 중"; "EXAM" -> "시험 감시 중"; else -> "대기" }
        val elapsed = if (phase == "IDLE") 0L else (System.currentTimeMillis() - startMs) / 1000
        val file = writer?.file?.absolutePath ?: "-"
        val extra = if (status.text.startsWith("권한")) "\n" + status.text else ""
        status.text = "상태: $label · %02d:%02d\n관측 %d건 · 기기 %d개 · 기준선 %d개\n파일: %s%s".format(elapsed / 60, elapsed % 60, lines, uniqueIds.size, detector.baselineSize, file, extra)
        alertView.text = if (alerts.isEmpty()) "없음" else alerts.joinToString("\n")
    }
}
