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

    /// Paths checked during the most recent call to `resolveBackdotPath()`.
    /// Populated for use in error UI when the CLI cannot be found.
    nonisolated(unsafe) static var searchedPaths: [String] = []

    /// Resolves the full path to the `backdot` executable by checking (in order):
    /// 1. A bundled copy inside the .app's Resources (distributed build)
    /// 2. Common Node.js / version-manager install locations
    /// 3. nvm directory scanning (versioned paths)
    /// 4. The user's shell PATH (sourcing .zshrc for nvm/fnm/etc.)
    nonisolated static func resolveBackdotPath() -> String? {
        var searched: [String] = []
        let home = FileManager.default.homeDirectoryForCurrentUser.path

        if let resourcePath = Bundle.main.resourcePath {
            let bundledPath = "\(resourcePath)/backdot"
            searched.append(bundledPath)
            if FileManager.default.isExecutableFile(atPath: bundledPath) {
                searchedPaths = searched
                return bundledPath
            }
        }

        let commonPaths = [
            "/usr/local/bin/backdot",
            "/opt/homebrew/bin/backdot",
            "\(home)/.npm-global/bin/backdot",
            "\(home)/.volta/bin/backdot",
            "\(home)/.asdf/shims/backdot",
        ]

        for p in commonPaths {
            searched.append(p)
            if FileManager.default.isExecutableFile(atPath: p) {
                searchedPaths = searched
                return p
            }
        }

        // nvm installs Node versions in ~/.nvm/versions/node/<version>/bin/;
        // scan in reverse-sorted order so the latest version wins.
        let nvmDir = "\(home)/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvmDir) {
            for version in versions.sorted().reversed() {
                let p = "\(nvmDir)/\(version)/bin/backdot"
                searched.append(p)
                if FileManager.default.isExecutableFile(atPath: p) {
                    searchedPaths = searched
                    return p
                }
            }
        }

        searched.append("which backdot (via zsh)")
        let result = shell("/bin/zsh", arguments: ["-l", "-c",
            "[ -f ~/.zshrc ] && source ~/.zshrc 2>/dev/null; which backdot"])
        let p = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
        if !p.isEmpty {
            searchedPaths = searched
            return p
        }

        searchedPaths = searched
        return nil
    }

    /// Runs a `backdot` CLI command and returns its output and exit code.
    /// Resolves the backdot executable path automatically.
    static func run(_ arguments: [String], stdinData: String? = nil) async -> (output: String, exitCode: Int32) {
        guard let backdotPath = resolveBackdotPath() else {
            return ("backdot not found on PATH", 1)
        }
        let path = backdotPath
        let args = arguments
        let input = stdinData
        return await Task.detached {
            let result = shell(path, arguments: args, stdinData: input)
            return (result.output, result.exitCode)
        }.value
    }

    func runBackup() {
        guard backupState != .running else { return }
        backupState = .running

        guard let backdotPath = Self.resolveBackdotPath() else {
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
        guard let backdotPath = Self.resolveBackdotPath() else {
            return (false, "backdot not found on PATH")
        }
        let result = Self.shell(backdotPath, arguments: ["schedule"])
        return (result.exitCode == 0, result.output.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func unschedule() async -> (success: Bool, message: String) {
        guard let backdotPath = Self.resolveBackdotPath() else {
            return (false, "backdot not found on PATH")
        }
        let result = Self.shell(backdotPath, arguments: ["unschedule"])
        return (result.exitCode == 0, result.output.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private struct ShellResult: Sendable {
        let output: String
        let exitCode: Int32
    }

    private nonisolated static func shell(_ path: String, arguments: [String] = [], stdinData: String? = nil) -> ShellResult {
        let process = Process()
        let outPipe = Pipe()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = arguments
        process.standardOutput = outPipe
        process.standardError = outPipe

        if let stdinData, let data = stdinData.data(using: .utf8) {
            let inPipe = Pipe()
            process.standardInput = inPipe
            inPipe.fileHandleForWriting.write(data)
            inPipe.fileHandleForWriting.closeFile()
        }

        var env = ProcessInfo.processInfo.environment
        let extraPaths = ["/usr/local/bin", "/opt/homebrew/bin"]
        let existingPath = env["PATH"] ?? "/usr/bin:/bin"
        env["PATH"] = (extraPaths + [existingPath]).joined(separator: ":")
        process.environment = env

        do {
            try process.run()
            process.waitUntilExit()
            let data = outPipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: data, encoding: .utf8) ?? ""
            return ShellResult(output: output, exitCode: process.terminationStatus)
        } catch {
            return ShellResult(output: error.localizedDescription, exitCode: 1)
        }
    }
}
