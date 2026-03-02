import Foundation
import SwiftUI

enum RepoStatus: Equatable {
    case idle
    case checking
    case privateRepo
    case publicRepo
    case notFound(String)
    case unknownVisibility
}

@MainActor
class RepoValidator: ObservableObject {
    @Published var status: RepoStatus = .idle

    private var debounceTask: Task<Void, Never>?
    private static let knownHosts = ["github.com", "gitlab.com", "bitbucket.org"]

    func validate(_ repository: String) {
        debounceTask?.cancel()

        guard !repository.trimmingCharacters(in: .whitespaces).isEmpty else {
            status = .idle
            return
        }

        status = .checking
        debounceTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            let result = await Self.checkRepository(repository)
            guard !Task.isCancelled else { return }
            self.status = result
        }
    }

    private static func checkRepository(_ repository: String) async -> RepoStatus {
        let authenticated = await runGitLsRemote(repository, anonymous: false)
        if !authenticated {
            return .notFound("Repository not found or not accessible")
        }

        guard let httpsUrl = toHttpsUrl(repository) else {
            return .unknownVisibility
        }

        let anonymous = await runGitLsRemote(httpsUrl, anonymous: true)
        return anonymous ? .publicRepo : .privateRepo
    }

    /// Converts an SSH or HTTPS repo URL to an anonymous HTTPS URL for known hosts.
    private static func toHttpsUrl(_ repository: String) -> String? {
        for host in knownHosts {
            guard let idx = repository.range(of: host) else { continue }
            let afterHost = repository[idx.upperBound...]
            guard let first = afterHost.first else { continue }
            // Skip the separator: ":" for SSH or "/" for HTTPS
            guard first == ":" || first == "/" else { continue }
            var repoPath = String(afterHost.dropFirst()).trimmingCharacters(in: .whitespaces)
            if repoPath.hasSuffix(".git") {
                repoPath = String(repoPath.dropLast(4))
            }
            return "https://\(host)/\(repoPath).git"
        }
        return nil
    }

    private static func runGitLsRemote(_ url: String, anonymous: Bool) async -> Bool {
        await withCheckedContinuation { continuation in
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/git")

            if anonymous {
                process.arguments = ["-c", "credential.helper=", "ls-remote", "--quiet", url]
            } else {
                process.arguments = ["ls-remote", "--quiet", url]
            }

            process.standardOutput = pipe
            process.standardError = pipe

            var env = ProcessInfo.processInfo.environment
            env["GIT_TERMINAL_PROMPT"] = "0"
            let extraPaths = ["/usr/local/bin", "/opt/homebrew/bin"]
            let existingPath = env["PATH"] ?? "/usr/bin:/bin"
            env["PATH"] = (extraPaths + [existingPath]).joined(separator: ":")
            process.environment = env

            do {
                try process.run()
                process.waitUntilExit()
                continuation.resume(returning: process.terminationStatus == 0)
            } catch {
                continuation.resume(returning: false)
            }
        }
    }
}
