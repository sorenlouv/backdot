import SwiftUI

struct ConfigWindow: View {
    @EnvironmentObject var configManager: ConfigManager
    @StateObject private var passwordManager = PasswordManager()
    @StateObject private var repoValidator = RepoValidator()

    @State private var newPathText = ""
    @State private var passwordInput = ""

    var body: some View {
        VStack(spacing: 0) {
            Form {
                generalSection
                pathsSection
                encryptionSection
            }
            .formStyle(.grouped)

            footer
        }
        .frame(width: 520, height: 540)
        .onAppear {
            NSApp.setActivationPolicy(.regular)
            configManager.load()
            passwordManager.refresh()
            repoValidator.validate(configManager.config.repository)
        }
        .onDisappear {
            NSApp.setActivationPolicy(.accessory)
        }
    }

    // MARK: - General

    @ViewBuilder
    private var generalSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                TextField("Repository", text: $configManager.config.repository, prompt: Text("git@github.com:user/repo.git"))
                    .font(.system(.body, design: .monospaced))
                    .onChange(of: configManager.config.repository, perform: { newValue in
                        repoValidator.validate(newValue)
                    })

                repoStatusLabel
            }

            TextField("Machine", text: $configManager.config.machine, prompt: Text("my-laptop"))
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
                    } label: {
                        Image(systemName: "trash")
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                    .help("Remove path")
                }
            }

            HStack {
                TextField("Add path…", text: $newPathText, prompt: Text("~/.config/example"))
                    .font(.system(.body, design: .monospaced))
                    .onSubmit { addPath() }

                Button {
                    addPath()
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(.green)
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
                set: { configManager.config.encryptEnabled = $0 }
            ))

            if configManager.config.encryptEnabled {
                if passwordManager.hasKeyFile {
                    HStack {
                        Label("Password saved", systemImage: "key.fill")
                            .foregroundStyle(.green)

                        Spacer()

                        Text("~/.backdot.key")
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)

                        Button("Remove", role: .destructive) {
                            try? passwordManager.removeKeyFile()
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

                            Button("Save Password") {
                                guard !passwordInput.isEmpty else { return }
                                try? passwordManager.savePassword(passwordInput)
                                passwordInput = ""
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

    // MARK: - Footer

    @ViewBuilder
    private var footer: some View {
        HStack {
            Button("Revert") {
                configManager.load()
                passwordManager.refresh()
                repoValidator.validate(configManager.config.repository)
                newPathText = ""
                passwordInput = ""
            }
            .controlSize(.large)

            Spacer()

            if let error = configManager.loadError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }

            Spacer()

            Button("Save") {
                configManager.save()
            }
            .controlSize(.large)
            .keyboardShortcut(.defaultAction)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 14)
        .background(.bar)
    }

    // MARK: - Helpers

    private func addPath() {
        let trimmed = newPathText.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        withAnimation {
            configManager.config.paths.append(trimmed)
        }
        newPathText = ""
    }
}
