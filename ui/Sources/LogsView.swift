import SwiftUI

struct LogsView: View {
    let cliLogPath: String
    @StateObject private var logReader: LogFileReader

    init(cliLogPath: String) {
        self.cliLogPath = cliLogPath
        _logReader = StateObject(wrappedValue: LogFileReader(logFilePath: cliLogPath))
    }

    var body: some View {
        Group {
            if logReader.content.isEmpty {
                VStack(spacing: 8) {
                    Text("No logs yet")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                    Text("Logs will appear here after the first backup.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        Text(logReader.content)
                            .font(.system(.caption, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .textSelection(.enabled)
                            .id("logBottom")
                    }
                    .background(.background)
                    .onChange(of: logReader.content) { _ in
                        proxy.scrollTo("logBottom", anchor: .bottom)
                    }
                    .onAppear {
                        proxy.scrollTo("logBottom", anchor: .bottom)
                    }
                }
                .padding(12)
                .background {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.quaternary)
                }
                .padding(12)
            }
        }
        .onAppear { logReader.start() }
        .onDisappear { logReader.stop() }
    }
}

@MainActor
private class LogFileReader: ObservableObject {
    @Published var content = ""

    private let logFilePath: String
    private var source: DispatchSourceFileSystemObject?
    private var fileDescriptor: Int32 = -1

    init(logFilePath: String) {
        self.logFilePath = logFilePath
    }

    func start() {
        guard !logFilePath.isEmpty else { return }
        loadContent()
        watchFile()
    }

    func stop() {
        source?.cancel()
        source = nil
        if fileDescriptor >= 0 {
            close(fileDescriptor)
            fileDescriptor = -1
        }
    }

    private func loadContent() {
        guard let data = FileManager.default.contents(atPath: logFilePath),
              let text = String(data: data, encoding: .utf8) else {
            content = ""
            return
        }
        content = text
    }

    private func watchFile() {
        source?.cancel()
        if fileDescriptor >= 0 {
            close(fileDescriptor)
        }

        fileDescriptor = Darwin.open(logFilePath, O_EVTONLY)
        guard fileDescriptor >= 0 else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                self?.watchFile()
            }
            return
        }

        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fileDescriptor,
            eventMask: [.write, .rename, .delete],
            queue: .main
        )

        src.setEventHandler { [weak self] in
            self?.loadContent()
        }

        src.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.fileDescriptor >= 0 {
                Darwin.close(self.fileDescriptor)
                self.fileDescriptor = -1
            }
        }

        src.resume()
        source = src
    }
}
