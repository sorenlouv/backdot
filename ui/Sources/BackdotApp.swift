import SwiftUI

@main
struct BackdotApp: App {
    @StateObject private var pathsProvider = PathsProvider()
    @StateObject private var configManager = ConfigManager()
    @StateObject private var statusProvider = StatusProvider()
    @StateObject private var cliRunner = BackdotCLI()

    init() {
        NSSetUncaughtExceptionHandler { exception in
            let message = [
                "Uncaught exception: \(exception.name.rawValue)",
                "Reason: \(exception.reason ?? "unknown")",
                "Stack trace:",
                exception.callStackSymbols.joined(separator: "\n"),
            ].joined(separator: "\n")
            UILogger.log(message)
        }
    }

    var body: some Scene {
        MenuBarExtra("Backdot", systemImage: "arrow.triangle.2.circlepath.circle.fill") {
            MenuBarMenu()
                .environmentObject(pathsProvider)
                .environmentObject(configManager)
                .environmentObject(statusProvider)
                .environmentObject(cliRunner)
                .onChange(of: pathsProvider.loaded) { loaded in
                    if loaded {
                        configManager.configPath = pathsProvider.paths.configFile
                        configManager.load()
                    }
                }
        }
        .menuBarExtraStyle(.menu)

        Window("Backdot", id: "config") {
            ConfigWindow()
                .environmentObject(pathsProvider)
                .environmentObject(configManager)
                .environmentObject(statusProvider)
                .environmentObject(cliRunner)
        }
        .windowResizability(.contentSize)
        .defaultPosition(.center)
        .windowToolbarStyle(.unified)
    }
}
