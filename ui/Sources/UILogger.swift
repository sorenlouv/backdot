import Foundation

enum UILogger {
    /// Set by PathsProvider once `backdot paths` returns.
    /// Logging is a no-op while this is empty (before paths load).
    static var logPath = ""

    static func log(_ message: String, level: String = "error") {
        guard !logPath.isEmpty else { return }

        let timestamp = Self.formatTimestamp(Date())
        let line = "\(timestamp) [\(level)] \(message)\n"

        let dir = (logPath as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(
            atPath: dir, withIntermediateDirectories: true
        )

        if let handle = FileHandle(forWritingAtPath: logPath) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            handle.closeFile()
        } else {
            FileManager.default.createFile(atPath: logPath, contents: Data(line.utf8))
        }
    }

    private static func formatTimestamp(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: date)
    }
}
