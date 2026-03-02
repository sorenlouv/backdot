import Foundation
import SwiftUI

struct BackdotConfig: Codable, Equatable {
    var repository: String
    var machine: String
    var paths: [String]
    var encrypt: Bool?

    var encryptEnabled: Bool {
        get { encrypt ?? false }
        set { encrypt = newValue ? true : nil }
    }

    enum CodingKeys: String, CodingKey {
        case repository, machine, paths, encrypt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(repository, forKey: .repository)
        try container.encode(machine, forKey: .machine)
        try container.encode(paths, forKey: .paths)
        if let encrypt, encrypt {
            try container.encode(encrypt, forKey: .encrypt)
        }
    }

    static let empty = BackdotConfig(repository: "", machine: "", paths: [], encrypt: nil)
}

@MainActor
class ConfigManager: ObservableObject {
    var configPath = ""

    @Published var config: BackdotConfig = .empty
    @Published var loadError: String?
    @Published var showSavedIndicator = false

    private var debouncedSaveWorkItem: DispatchWorkItem?

    func load() {
        loadError = nil

        guard !configPath.isEmpty else {
            loadError = "Waiting for paths…"
            return
        }

        guard FileManager.default.fileExists(atPath: configPath) else {
            loadError = "Config not found. Run \"backdot init\" first."
            return
        }

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: configPath))
            config = try JSONDecoder().decode(BackdotConfig.self, from: data)
        } catch {
            loadError = "Failed to read config: \(error.localizedDescription)"
        }
    }

    func save() {
        guard !configPath.isEmpty else { return }

        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            let data = try encoder.encode(config)
            try data.write(to: URL(fileURLWithPath: configPath), options: .atomic)
            loadError = nil
            showSavedIndicator = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.showSavedIndicator = false
            }
        } catch {
            loadError = "Failed to save config: \(error.localizedDescription)"
            showSavedIndicator = false
        }
    }

    func autoSave() {
        debouncedSaveWorkItem?.cancel()
        debouncedSaveWorkItem = nil
        save()
    }

    func autoSaveDebounced(after delay: TimeInterval = 1.0) {
        debouncedSaveWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.save()
        }
        debouncedSaveWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
    }
}
