// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CozyFocusPet",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "CozyFocusCore", targets: ["CozyFocusCore"]),
    ],
    targets: [
        .target(
            name: "CozyFocusCore",
            resources: [.process("Resources")],
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .testTarget(
            name: "CozyFocusCoreTests",
            dependencies: ["CozyFocusCore"]
        ),
    ]
)
