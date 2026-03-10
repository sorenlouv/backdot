import Foundation
import SwiftUI

@MainActor
class PasswordManager: ObservableObject {
    func savePassword(_ rawPassword: String) async {
        _ = await BackdotCLI.run(["ui:set-password"], stdinData: rawPassword)
    }

    func removeKeyFile() async {
        _ = await BackdotCLI.run(["ui:remove-password-file"])
    }
}
