import Foundation
import CommonCrypto
import SwiftUI

@MainActor
class PasswordManager: ObservableObject {
    static let keyFilePath = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".backdot.key")

    @Published var hasKeyFile = false

    init() {
        refresh()
    }

    func refresh() {
        hasKeyFile = FileManager.default.fileExists(atPath: Self.keyFilePath.path)
    }

    /// Hashes the raw password with SHA-256 (matching the Node.js CLI behavior)
    /// and writes the hex digest to ~/.backdot.key with 0600 permissions.
    func savePassword(_ rawPassword: String) throws {
        let hashed = sha256Hex(rawPassword)
        let content = hashed + "\n"
        guard let data = content.data(using: .utf8) else { return }

        FileManager.default.createFile(
            atPath: Self.keyFilePath.path,
            contents: data,
            attributes: [.posixPermissions: 0o600]
        )
        refresh()
    }

    func removeKeyFile() throws {
        guard hasKeyFile else { return }
        try FileManager.default.removeItem(at: Self.keyFilePath)
        refresh()
    }

    private func sha256Hex(_ input: String) -> String {
        let data = Data(input.utf8)
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { buffer in
            _ = CC_SHA256(buffer.baseAddress, CC_LONG(buffer.count), &hash)
        }
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}
