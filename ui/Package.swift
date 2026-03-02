// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "BackdotUI",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "BackdotUI",
            path: "Sources"
        ),
    ]
)
