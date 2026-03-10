import Foundation
import SwiftUI

struct BackdotPaths: Codable, Equatable {
    var configFile: String
    var keyFile: String
    var stagingDir: String
    var logDir: String
    var cliLog: String
    var launchdLog: String
    var uiLog: String

    static let empty = BackdotPaths(
        configFile: "", keyFile: "", stagingDir: "",
        logDir: "", cliLog: "", launchdLog: "", uiLog: ""
    )
}

@MainActor
class PathsProvider: ObservableObject {
    @Published var paths = BackdotPaths.empty
    @Published var loaded = false
    @Published var cliError: String?

    init() {
        Task { await load() }
    }

    func load() async {
        cliError = nil
        let (output, exitCode) = await BackdotCLI.run(["ui:paths"])
        guard exitCode == 0 else {
            cliError = output.trimmingCharacters(in: .whitespacesAndNewlines)
            return
        }

        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let data = trimmed.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(BackdotPaths.self, from: data)
        else { return }

        paths = decoded
        loaded = true
        UILogger.logPath = decoded.uiLog
    }

    /// Replaces the user's home directory prefix with `~` for display.
    var displayKeyFilePath: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if paths.keyFile.hasPrefix(home) {
            return "~" + paths.keyFile.dropFirst(home.count)
        }
        return paths.keyFile
    }
}
