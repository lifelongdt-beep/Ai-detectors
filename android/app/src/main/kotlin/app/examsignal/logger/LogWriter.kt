package app.examsignal.logger

import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.util.concurrent.Executors

/** 단말 로컬 파일에만 기록한다. 네트워크 코드는 없다. */
class LogWriter(val file: File) {
    private val exec = Executors.newSingleThreadExecutor()
    private val out = BufferedWriter(FileWriter(file, true))

    fun writeLine(line: String) {
        exec.execute {
            try {
                out.write(line)
                out.newLine()
            } catch (e: Exception) {
                // 기록 실패는 화면의 줄 수 카운터로 드러난다
            }
        }
    }

    fun flush() {
        exec.execute { try { out.flush() } catch (e: Exception) { } }
    }

    fun close() {
        exec.execute {
            try { out.flush(); out.close() } catch (e: Exception) { }
        }
        exec.shutdown()
    }
}
