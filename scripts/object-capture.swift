// Local, optional object photogrammetry using Apple's on-device framework.
// Usage: swift scripts/object-capture.swift --check
//        swift scripts/object-capture.swift /path/to/object-photos /path/to/model.usdz
import Foundation
import RealityKit

if CommandLine.arguments.contains("--check") {
    print("ObjectCapture supported: \(PhotogrammetrySession.isSupported)")
    exit(PhotogrammetrySession.isSupported ? 0 : 2)
}
guard CommandLine.arguments.count == 3 else {
    print("Usage: swift scripts/object-capture.swift PHOTO_DIRECTORY OUTPUT.usdz")
    exit(1)
}
let input = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard PhotogrammetrySession.isSupported else { print("Object Capture is unsupported on this Mac."); exit(2) }
guard output.pathExtension.lowercased() == "usdz" else { print("Choose a .usdz output file."); exit(1) }
guard !FileManager.default.fileExists(atPath: output.path) else { print("Output already exists; choose a new file."); exit(1) }
let semaphore = DispatchSemaphore(value: 0)
Task.detached {
    do {
        var configuration = PhotogrammetrySession.Configuration()
        configuration.sampleOrdering = .unordered
        configuration.featureSensitivity = .normal
        let session = try PhotogrammetrySession(input: input, configuration: configuration)
        try session.process(requests: [.modelFile(url: output, detail: .medium)])
        for try await event in session.outputs {
            switch event {
            case .requestProgress(_, let fraction): print("Progress: \(Int(fraction * 100))%")
            case .requestError(_, let error): print("Reconstruction error: \(error)"); exit(3)
            case .processingComplete: print("Saved: \(output.path)"); semaphore.signal()
            default: break
            }
        }
    } catch { print("Object Capture failed: \(error)"); exit(3) }
}
semaphore.wait()
