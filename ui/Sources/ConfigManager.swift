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
    static let configPath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".backdot.json")

    @Published var config: BackdotConfig = .empty
    @Published var loadError: String?

    init() {
        load()
    }

    func load() {
        loadError = nil

        guard FileManager.default.fileExists(atPath: Self.configPath.path) else {
            loadError = "Config not found. Run \"backdot init\" first."
            return
        }

        do {
            let data = try Data(contentsOf: Self.configPath)
            let decoder = JSONDecoder()
            config = try decoder.decode(BackdotConfig.self, from: data)
        } catch {
            loadError = "Failed to read config: \(error.localizedDescription)"
        }
    }

    func save() {
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            let data = try encoder.encode(config)
            try data.write(to: Self.configPath, options: .atomic)
            loadError = nil
        } catch {
            loadError = "Failed to save config: \(error.localizedDescription)"
        }
    }
}
