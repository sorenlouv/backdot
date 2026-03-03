import SwiftUI

struct ConfigWindow: View {
    @EnvironmentObject var pathsProvider: PathsProvider
    @EnvironmentObject var configManager: ConfigManager
    @EnvironmentObject var statusProvider: StatusProvider
    @EnvironmentObject var cliRunner: BackdotCLI
    @StateObject private var passwordManager = PasswordManager()
    @StateObject private var repoValidator = RepoValidator()

    @State private var newPathText = ""
    @State private var passwordInput = ""
    @State private var scheduleLoading = false

    @FocusState private var repoFieldFocused: Bool
    @FocusState private var machineFieldFocused: Bool

    @State private var retrying = false

    var body: some View {
        Group {
            if pathsProvider.cliError != nil {
                cliNotFoundView
            } else {
                switch statusProvider.selectedTab {
                case .configuration:
                    configurationTab
                case .logs:
                    LogsView(cliLogPath: pathsProvider.paths.cliLog)
                }
            }
        }
        .frame(width: 520, height: 540)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("", selection: $statusProvider.selectedTab) {
                    ForEach(WindowTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 200)
            }
        }
        .onAppear {
            NSApp.setActivationPolicy(.regular)
            if let iconURL = Bundle.module.url(forResource: "AppIcon", withExtension: "png"),
               let icon = NSImage(contentsOf: iconURL) {
                NSApp.applicationIconImage = icon
            }
            if pathsProvider.loaded {
                configManager.configPath = pathsProvider.paths.configFile
            }
            configManager.load()
            statusProvider.refresh()
            repoValidator.validate(configManager.config.repository)
        }
        .onChange(of: pathsProvider.loaded) { loaded in
            if loaded {
                configManager.configPath = pathsProvider.paths.configFile
                configManager.load()
            }
        }
        .onDisappear {
            NSApp.setActivationPolicy(.accessory)
        }
    }

    // MARK: - CLI Not Found

    private var cliNotFoundView: some View {
        VStack(spacing: 16) {
            Spacer()

            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)

            Text("Backdot CLI not found")
                .font(.title2)
                .fontWeight(.semibold)

            Text("The app could not locate the backdot command-line tool.\nInstall it with:")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            HStack(spacing: 8) {
                Text("npm install -g backdot")
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.quaternary)
                    .cornerRadius(6)
            }

            Button {
                retrying = true
                Task {
                    await pathsProvider.load()
                    retrying = false
                }
            } label: {
                if retrying {
                    ProgressView()
                        .controlSize(.small)
                        .frame(width: 50)
                } else {
                    Text("Retry")
                        .frame(width: 50)
                }
            }
            .disabled(retrying)

            DisclosureGroup("Searched locations") {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(BackdotCLI.searchedPaths, id: \.self) { path in
                        Text(path)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
            }
            .frame(width: 360)
            .foregroundStyle(.secondary)

            Spacer()
        }
        .padding()
    }

    // MARK: - Configuration

    private var configurationTab: some View {
        VStack(spacing: 0) {
            Form {
                generalSection
                pathsSection
                encryptionSection
                scheduleSection
            }
            .formStyle(.grouped)

            HStack {
                if let error = configManager.loadError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }

                Spacer()

                if configManager.showSavedIndicator {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Saved")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: configManager.showSavedIndicator)
            .padding(.horizontal, 20)
            .padding(.vertical, 8)
        }
    }

    // MARK: - General

    @ViewBuilder
    private var generalSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                TextField("Repository", text: $configManager.config.repository, prompt: Text("git@github.com:user/repo.git"))
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
                    .focused($repoFieldFocused)
                    .onChange(of: configManager.config.repository) { newValue in
                        repoValidator.validate(newValue)
                        configManager.autoSaveDebounced()
                    }
                    .onChange(of: repoFieldFocused) { focused in
                        if !focused { configManager.autoSave() }
                    }
                    .onSubmit { configManager.autoSave() }

                repoStatusLabel
            }

            TextField("Machine", text: $configManager.config.machine, prompt: Text("my-laptop"))
                .textFieldStyle(.roundedBorder)
                .focused($machineFieldFocused)
                .onChange(of: configManager.config.machine) { _ in
                    configManager.autoSaveDebounced()
                }
                .onChange(of: machineFieldFocused) { focused in
                    if !focused { configManager.autoSave() }
                }
                .onSubmit { configManager.autoSave() }
        } header: {
            Text("General")
        }
    }

    @ViewBuilder
    private var repoStatusLabel: some View {
        HStack(spacing: 5) {
            switch repoValidator.status {
            case .idle:
                EmptyView()
            case .checking:
                ProgressView()
                    .scaleEffect(0.5)
                    .frame(width: 12, height: 12)
                Text("Checking repository…")
                    .foregroundStyle(.secondary)
            case .privateRepo:
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Private repository")
                    .foregroundStyle(.green)
            case .publicRepo:
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red)
                Text("Repository is public — backups will be refused")
                    .foregroundStyle(.red)
            case .notFound(let message):
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red)
                Text(message)
                    .foregroundStyle(.red)
            case .unknownVisibility:
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text("Repository found (visibility unknown)")
                    .foregroundStyle(.orange)
            }
        }
        .font(.caption)
    }

    // MARK: - Paths

    @ViewBuilder
    private var pathsSection: some View {
        Section {
            ForEach(Array(configManager.config.paths.enumerated()), id: \.offset) { index, path in
                HStack {
                    Text(path)
                        .font(.system(.body, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        withAnimation {
                            _ = configManager.config.paths.remove(at: index as Int)
                        }
                        configManager.autoSave()
                    } label: {
                        Image(systemName: "trash")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Remove path")
                }
            }

            HStack {
                TextField("Add path…", text: $newPathText, prompt: Text("~/.config/example"))
                    .textFieldStyle(.roundedBorder)
                    .font(.system(.body, design: .monospaced))
                    .onSubmit { addPath() }

                Button {
                    addPath()
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(Color.accentColor)
                }
                .buttonStyle(.plain)
                .disabled(newPathText.trimmingCharacters(in: .whitespaces).isEmpty)
                .help("Add path")
            }
        } header: {
            Text("Paths")
        } footer: {
            Text("Glob patterns supported. Prefix with ! to exclude. ~ expands to home.")
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Encryption

    @ViewBuilder
    private var encryptionSection: some View {
        Section {
            Toggle("Encrypt backups", isOn: Binding(
                get: { configManager.config.encryptEnabled },
                set: {
                    configManager.config.encryptEnabled = $0
                    configManager.autoSave()
                }
            ))

            if configManager.config.encryptEnabled {
                if statusProvider.passwordFileExists {
                    HStack {
                        Label("Password saved", systemImage: "key.fill")
                            .foregroundStyle(.green)

                        Spacer()

                        Text(pathsProvider.displayKeyFilePath)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)

                        Button("Remove", role: .destructive) {
                            Task {
                                await passwordManager.removeKeyFile()
                                statusProvider.refresh()
                            }
                        }
                        .controlSize(.small)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("No password file found. Set one for automated backups.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        HStack {
                            SecureField("Encryption password", text: $passwordInput)
                                .textFieldStyle(.roundedBorder)

                            Button("Save Password") {
                                guard !passwordInput.isEmpty else { return }
                                let pw = passwordInput
                                passwordInput = ""
                                Task {
                                    await passwordManager.savePassword(pw)
                                    statusProvider.refresh()
                                }
                            }
                            .controlSize(.small)
                            .disabled(passwordInput.isEmpty)
                        }
                    }
                }
            }
        } header: {
            Text("Encryption")
        }
    }

    // MARK: - Schedule

    @ViewBuilder
    private var scheduleSection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { statusProvider.isScheduled },
                set: { enable in
                    scheduleLoading = true
                    Task {
                        let result = enable
                            ? await cliRunner.schedule()
                            : await cliRunner.unschedule()
                        if !result.success {
                            UILogger.log("Schedule \(enable ? "enable" : "disable") failed: \(result.message)")
                        }
                        statusProvider.refresh()
                        scheduleLoading = false
                    }
                }
            )) {
                HStack(spacing: 6) {
                    Text("Daily backup at 02:00")
                    if scheduleLoading {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
            }
            .disabled(scheduleLoading)
        } header: {
            Text("Schedule")
        }
    }

    // MARK: - Helpers

    private func addPath() {
        let trimmed = newPathText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        withAnimation {
            configManager.config.paths.append(trimmed)
        }
        newPathText = ""
        configManager.autoSave()
    }
}
