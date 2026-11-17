package app.examsignal.logger.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreTest {
    @Test
    fun hashIsStableAndKeyed() {
        val a = Ids.hash("k1", "AA:BB:CC:DD:EE:FF")
        assertEquals(8, a.length)
        assertEquals(a, Ids.hash("k1", "AA:BB:CC:DD:EE:FF"))
        assertNotEquals(a, Ids.hash("k2", "AA:BB:CC:DD:EE:FF"))
        assertTrue(!a.contains("AA:BB"))
    }

    @Test
    fun csvRowEscapesCommas() {
        val r = Csv.row(1000L, "교실,1", "EXAM", "R3-C2", "BLE", "ab12cd34", -61, "76")
        assertEquals("1000,교실_1,EXAM,R3-C2,BLE,ab12cd34,-61,76", r)
        assertEquals(8, Csv.HEADER.split(",").size)
        assertEquals(8, r.split(",").size)
    }

    private fun s(t: Long, id: String, rssi: Int) = Sighting(t, "BLE", id, rssi, "R3-C2")

    @Test
    fun baselineDevicesNeverAlert() {
        val d = Detector()
        d.observe(s(0, "router", -50))
        d.baselineMode = false
        for (i in 1..10) assertNull(d.observe(s(i * 1000L, "router", -50)))
    }

    @Test
    fun newStrongDeviceAlertsAfterRepeatedSightings() {
        val d = Detector()
        d.baselineMode = false
        assertNull(d.observe(s(0, "x", -60)))
        assertNull(d.observe(s(1000, "x", -58)))
        val a = d.observe(s(2000, "x", -62))
        assertNotNull(a)
        assertEquals(-58, a!!.strongestRssi)
        assertEquals("근접", a.proximity)
    }

    @Test
    fun weakOrSparseSignalsDoNotAlert() {
        val d = Detector()
        d.baselineMode = false
        for (i in 0..9) assertNull(d.observe(s(i * 1000L, "weak", -90)))
        // 창(20초) 밖으로 흩어진 관측은 누적되지 않는다
        for (i in 0..5) assertNull(d.observe(s(i * 30_000L, "sparse", -60)))
    }

    @Test
    fun cooldownSuppressesRepeatAlerts() {
        val d = Detector()
        d.baselineMode = false
        var count = 0
        for (i in 0..30) if (d.observe(s(i * 1000L, "x", -60)) != null) count++
        assertEquals(1, count)
    }
}
