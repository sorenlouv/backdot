import SwiftUI

struct MenuBarMenu: View {
    @EnvironmentObject var configManager: ConfigManager
    @EnvironmentObject var statusProvider: StatusProvider
    @EnvironmentObject var cliRunner: BackdotCLI

    @Environment(\.openWindow) private var openWindow

    @State private var scheduleLoading = false

    var body: some View {
        statusItems
        Divider()
        actionItems
        Divider()
        configItem
        Divider()
        quitItem
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

            Button(lastBackupText) {}
                .disabled(true)

            Button(scheduleText) {}
                .disabled(true)
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

    private var scheduleText: String {
        statusProvider.isScheduled ? "Schedule: daily at 02:00" : "Schedule: off"
    }

    // MARK: - Actions

    @ViewBuilder
    private var actionItems: some View {
        let isRunning = cliRunner.backupState == .running
        Button(isRunning ? "Backing up…" : "Back Up Now") {
            cliRunner.runBackup()
        }
        .disabled(isRunning || configManager.loadError != nil)

        Button(statusProvider.isScheduled ? "Remove Schedule" : "Schedule Daily Backup") {
            scheduleLoading = true
            Task {
                if statusProvider.isScheduled {
                    _ = await cliRunner.unschedule()
                } else {
                    _ = await cliRunner.schedule()
                }
                statusProvider.refresh()
                scheduleLoading = false
            }
        }
        .disabled(scheduleLoading || configManager.loadError != nil)
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
