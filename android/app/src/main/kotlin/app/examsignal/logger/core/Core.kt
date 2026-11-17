package app.examsignal.logger.core

import java.security.MessageDigest

/** 기기 식별자는 시험 세션 키로 해시한 앞 8자리만 쓴다 (원본 MAC 주소는 저장하지 않음). */
object Ids {
    fun hash(sessionKey: String, raw: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest("$sessionKey|$raw".toByteArray(Charsets.UTF_8))
        return digest.take(4).joinToString("") { b -> String.format("%02x", b) }
    }
}

object Csv {
    const val HEADER = "t_ms,observer,phase,pos,type,id,rssi,extra"

    private fun clean(s: String): String = s.replace(',', '_').replace('\n', ' ').replace('\r', ' ')

    fun row(tMs: Long, observer: String, phase: String, pos: String, type: String, id: String, rssi: Int, extra: String): String =
        listOf(tMs.toString(), clean(observer), phase, clean(pos), type, id, rssi.toString(), clean(extra)).joinToString(",")
}

data class Sighting(val tMs: Long, val type: String, val id: String, val rssi: Int, val pos: String)

data class Alert(val tMs: Long, val type: String, val id: String, val strongestRssi: Int, val pos: String, val count: Int) {
    val proximity: String
        get() = when {
            strongestRssi >= -55 -> "매우 근접"
            strongestRssi >= -65 -> "근접"
            else -> "주변"
        }
}

/**
 * 기준선 단계에서 본 기기(공유기, 감독관 기기 등)는 정상으로 보고,
 * 시험 중 새로 나타난 기기가 일정 세기 이상으로 반복 관측되면 알린다.
 * 알림은 감독관이 확인할 단서일 뿐 부정행위의 증거가 아니다.
 */
class Detector(
    private val rssiThreshold: Int = -75,
    private val minSightings: Int = 3,
    private val windowMs: Long = 20_000,
    private val cooldownMs: Long = 60_000,
) {
    var baselineMode: Boolean = true
    private val baseline = HashSet<String>()
    private val recent = HashMap<String, ArrayDeque<Sighting>>()
    private val lastAlert = HashMap<String, Long>()

    val baselineSize: Int get() = baseline.size

    fun observe(s: Sighting): Alert? {
        if (baselineMode) {
            baseline.add(s.id)
            return null
        }
        if (s.id in baseline || s.rssi < rssiThreshold) return null
        val q = recent.getOrPut(s.id) { ArrayDeque() }
        q.addLast(s)
        while (q.isNotEmpty() && s.tMs - q.first().tMs > windowMs) q.removeFirst()
        if (q.size < minSightings) return null
        val last = lastAlert[s.id]
        if (last != null && s.tMs - last < cooldownMs) return null
        lastAlert[s.id] = s.tMs
        val best = q.maxByOrNull { it.rssi } ?: s
        return Alert(s.tMs, s.type, s.id, best.rssi, best.pos, q.size)
    }
}
