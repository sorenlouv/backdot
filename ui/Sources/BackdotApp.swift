import SwiftUI

@main
struct BackdotApp: App {
    @StateObject private var configManager = ConfigManager()
    @StateObject private var statusProvider = StatusProvider()
    @StateObject private var cliRunner = BackdotCLI()

    var body: some Scene {
        MenuBarExtra("Backdot", systemImage: "arrow.triangle.2.circlepath.circle.fill") {
            MenuBarMenu()
                .environmentObject(configManager)
                .environmentObject(statusProvider)
                .environmentObject(cliRunner)
        }
        .menuBarExtraStyle(.menu)

        Window("Backdot Configuration", id: "config") {
            ConfigWindow()
                .environmentObject(configManager)
        }
        .windowResizability(.contentSize)
        .defaultPosition(.center)
    }
}
