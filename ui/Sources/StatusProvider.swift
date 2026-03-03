import Foundation
import SwiftUI

enum WindowTab: String, CaseIterable {
    case configuration = "Configuration"
    case logs = "Logs"
}

@MainActor
class StatusProvider: ObservableObject {
    @Published var isScheduled = false
    @Published var passwordFileExists = false
    @Published var lastBackupTime: Date?
    @Published var lastBackupSuccess: Bool?
    @Published var lastBackupCommitUrl: URL?
    @Published var selectedTab: WindowTab = .configuration

    init() {
        refresh()
        refreshLastBackup()
    }

    func refresh() {
        Task {
            let (output, exitCode) = await BackdotCLI.run(["ui:get-schedule-and-encryption-file-status"])
            guard exitCode == 0 else { return }

            let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let data = trimmed.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return
            }

            isScheduled = json["scheduled"] as? Bool ?? false
            passwordFileExists = json["passwordFileExists"] as? Bool ?? false
        }
    }

    func refreshLastBackup() {
        Task {
            let (output, exitCode) = await BackdotCLI.run(["ui:get-last-backup-timestamp"])
            guard exitCode == 0 else { return }

            let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let data = trimmed.data(using: .utf8) else {
                lastBackupTime = nil
                lastBackupSuccess = nil
                lastBackupCommitUrl = nil
                return
            }

            if let backup = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let timeString = backup["time"] as? String {
                lastBackupTime = Self.parseTimestamp(timeString)
                lastBackupSuccess = backup["success"] as? Bool
                lastBackupCommitUrl = (backup["commitUrl"] as? String).flatMap(URL.init)
            } else {
                lastBackupTime = nil
                lastBackupSuccess = nil
                lastBackupCommitUrl = nil
            }
        }
    }

    /// Parses the "YYYY-MM-DD HH:mm:ss" timestamp format from the backup log.
    private static func parseTimestamp(_ string: String) -> Date? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        return formatter.date(from: string)
    }
}
