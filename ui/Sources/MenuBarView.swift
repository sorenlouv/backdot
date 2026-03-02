import SwiftUI

struct MenuBarMenu: View {
    @EnvironmentObject var configManager: ConfigManager
    @EnvironmentObject var statusProvider: StatusProvider
    @EnvironmentObject var cliRunner: BackdotCLI

    @Environment(\.openWindow) private var openWindow

    @State private var pollingTimer: Timer?

    var body: some View {
        Group {
            statusItems
            Divider()
            actionItems
            Divider()
            configItem
            Divider()
            quitItem
        }
        .onAppear {
            statusProvider.refreshLastBackup()
            pollingTimer?.invalidate()
            let timer = Timer(timeInterval: 1, repeats: true) { _ in
                Task { @MainActor in
                    statusProvider.refreshLastBackup()
                }
            }
            RunLoop.main.add(timer, forMode: .common)
            pollingTimer = timer
        }
        .onDisappear {
            pollingTimer?.invalidate()
            pollingTimer = nil
        }
    }

    // MARK: - Status

    @ViewBuilder
    private var statusItems: some View {
        if let error = configManager.loadError {
            Button(error) {}
                .disabled(true)
        } else {
            Button("Machine: \(configManager.config.machine)") {}
                .disabled(true)

            if let commitUrl = statusProvider.lastBackupCommitUrl {
                Button(lastBackupText) {
                    NSWorkspace.shared.open(commitUrl)
                }
            } else {
                Button(lastBackupText) {}
                    .disabled(true)
            }

            if statusProvider.lastBackupSuccess == false {
                Button("View Logs…") {
                    statusProvider.selectedTab = .logs
                    openWindow(id: "config")
                    NSApp.activate(ignoringOtherApps: true)
                }
            }

        }
    }

    private var lastBackupText: String {
        guard let time = statusProvider.lastBackupTime else {
            return "Last backup: never"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        let relative = formatter.localizedString(for: time, relativeTo: Date())
        let success = statusProvider.lastBackupSuccess ?? true
        return success ? "Last backup: \(relative)" : "Last backup: failed \(relative)"
    }

    // MARK: - Actions

    @ViewBuilder
    private var actionItems: some View {
        let isRunning = cliRunner.backupState == .running
        Button(isRunning ? "Backing up…" : "Back Up Now") {
            cliRunner.runBackup()
        }
        .disabled(isRunning || configManager.loadError != nil)
    }

    // MARK: - Config

    @ViewBuilder
    private var configItem: some View {
        Button("Edit Configuration…") {
            openWindow(id: "config")
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    // MARK: - Quit

    @ViewBuilder
    private var quitItem: some View {
        Button("Quit Backdot") {
            NSApplication.shared.terminate(nil)
        }
    }
}
