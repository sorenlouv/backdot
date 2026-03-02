import Foundation
import SwiftUI

@MainActor
class StatusProvider: ObservableObject {
    @Published var isScheduled = false
    @Published var lastBackupTime: Date?
    @Published var lastBackupSuccess: Bool?

    private static let plistPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/LaunchAgents/com.backdot.daemon.plist")
    private static let logPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".backdot/backup.log")
    private static let launchdJobLabel = "com.backdot.daemon"

    init() {
        refresh()
    }

    func refresh() {
        isScheduled = checkScheduled()
        parseLastBackup()
    }

    private func checkScheduled() -> Bool {
        guard FileManager.default.fileExists(atPath: Self.plistPath.path) else {
            return false
        }
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["list", Self.launchdJobLabel]
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""
            return output.contains(Self.launchdJobLabel)
        } catch {
            return false
        }
    }

    /// Parses the last backup timestamp and result from the winston JSON log.
    /// Lines look like: {"level":"info","message":"Backup complete","timestamp":"2025-..."}
    private func parseLastBackup() {
        guard let content = try? String(contentsOf: Self.logPath, encoding: .utf8) else {
            lastBackupTime = nil
            lastBackupSuccess = nil
            return
        }

        let lines = content.components(separatedBy: .newlines).reversed()

        for line in lines {
            guard !line.isEmpty,
                  let data = line.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let message = json["message"] as? String,
                  let timestamp = json["timestamp"] as? String
            else { continue }

            let isBackupLine = message.contains("Backup complete") || message.contains("Starting backup")
            guard isBackupLine else { continue }

            lastBackupSuccess = message.contains("Backup complete")
            lastBackupTime = parseISO8601(timestamp)
            return
        }

        lastBackupTime = nil
        lastBackupSuccess = nil
    }

    private func parseISO8601(_ string: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: string) ?? ISO8601DateFormatter().date(from: string)
    }
}
