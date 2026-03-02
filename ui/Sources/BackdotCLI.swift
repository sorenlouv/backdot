import Foundation
import SwiftUI

enum BackupState: Equatable {
    case idle
    case running
    case success(String)
    case failure(String)
}

@MainActor
class BackdotCLI: ObservableObject {
    @Published var backupState: BackupState = .idle

    /// Resolves the full path to the `backdot` executable by searching common
    /// Node.js install locations and the user's shell PATH.
    private func resolveBackdotPath() -> String? {
        let commonPaths = [
            "/usr/local/bin/backdot",
            "/opt/homebrew/bin/backdot",
            "\(FileManager.default.homeDirectoryForCurrentUser.path)/.npm-global/bin/backdot",
        ]

        for p in commonPaths {
            if FileManager.default.isExecutableFile(atPath: p) {
                return p
            }
        }

        let result = Self.shell("/bin/zsh", arguments: ["-l", "-c", "which backdot"])
        let p = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
        return p.isEmpty ? nil : p
    }

    func runBackup() {
        guard backupState != .running else { return }
        backupState = .running

        guard let backdotPath = resolveBackdotPath() else {
            backupState = .failure("backdot not found on PATH")
            return
        }

        let path = backdotPath
        Task.detached {
            let result = Self.shell(path, arguments: ["backup"])
            await MainActor.run { [weak self] in
                if result.exitCode == 0 {
                    self?.backupState = .success("Backup complete")
                } else {
                    let errorMsg = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
                    self?.backupState = .failure(errorMsg.isEmpty ? "Backup failed" : errorMsg)
                }
            }
        }
    }

    func schedule() async -> (success: Bool, message: String) {
        guard let backdotPath = resolveBackdotPath() else {
            return (false, "backdot not found on PATH")
        }
        let result = Self.shell(backdotPath, arguments: ["schedule"])
        return (result.exitCode == 0, result.output.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func unschedule() async -> (success: Bool, message: String) {
        guard let backdotPath = resolveBackdotPath() else {
            return (false, "backdot not found on PATH")
        }
        let result = Self.shell(backdotPath, arguments: ["unschedule"])
        return (result.exitCode == 0, result.output.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private struct ShellResult: Sendable {
        let output: String
        let exitCode: Int32
    }

    private nonisolated static func shell(_ path: String, arguments: [String] = []) -> ShellResult {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = pipe

        var env = ProcessInfo.processInfo.environment
        let extraPaths = ["/usr/local/bin", "/opt/homebrew/bin"]
        let existingPath = env["PATH"] ?? "/usr/bin:/bin"
        env["PATH"] = (extraPaths + [existingPath]).joined(separator: ":")
        process.environment = env

        do {
            try process.run()
            process.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""
            return ShellResult(output: output, exitCode: process.terminationStatus)
        } catch {
            return ShellResult(output: error.localizedDescription, exitCode: 1)
        }
    }
}
