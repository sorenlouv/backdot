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
        let (output, exitCode) = await BackdotCLI.run(["ui:check-repo", repository])

        guard exitCode == 0 else {
            return .notFound("backdot CLI error")
        }

        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let status = json["status"] as? String else {
            return .unknownVisibility
        }

        switch status {
        case "private":
            return .privateRepo
        case "public":
            return .publicRepo
        case "not_found":
            let message = json["message"] as? String ?? "Repository not found or not accessible"
            return .notFound(message)
        default:
            return .unknownVisibility
        }
    }
}
