import SwiftUI
import CozyFocusCore

enum CozyPalette {
    static let background = Color(red: 0.98, green: 0.96, blue: 0.91)
    static let sidebar = Color(red: 0.94, green: 0.91, blue: 0.84)
    static let ink = Color(red: 0.25, green: 0.29, blue: 0.23)
    static let muted = Color(red: 0.45, green: 0.48, blue: 0.40)
    static let green = Color(red: 0.33, green: 0.48, blue: 0.36)
    static let paleGreen = Color(red: 0.87, green: 0.92, blue: 0.83)
    static let focusBlock = Color(red: 0.68, green: 0.83, blue: 0.65)
    static let meetingBlock = Color(red: 0.19, green: 0.36, blue: 0.26)
    static let breakRainbow = LinearGradient(
        colors: [
            Color(red: 0.97, green: 0.80, blue: 0.81),
            Color(red: 0.99, green: 0.87, blue: 0.72),
            Color(red: 0.97, green: 0.94, blue: 0.73),
            Color(red: 0.79, green: 0.90, blue: 0.79),
            Color(red: 0.79, green: 0.87, blue: 0.94),
            Color(red: 0.89, green: 0.82, blue: 0.93)
        ],
        startPoint: .leading,
        endPoint: .trailing
    )
    static let peach = Color(red: 0.98, green: 0.87, blue: 0.77)
    static let card = Color(red: 1.0, green: 0.99, blue: 0.96)
}

struct RoomDecoration: Identifiable {
    let id: String
    let symbol: String
    let size: CGFloat
    let x: CGFloat
    let y: CGFloat
    let tint: Color
    let accessibilityLabel: String
}

enum RoomCatalog {
    static let decorations = [
        RoomDecoration(id: "cushion", symbol: "circle.fill", size: 135, x: 0, y: 120,
                       tint: CozyPalette.peach, accessibilityLabel: "Soft cushion"),
        RoomDecoration(id: "plant", symbol: "leaf.fill", size: 66, x: -230, y: 85,
                       tint: CozyPalette.green, accessibilityLabel: "Window plant"),
        RoomDecoration(id: "lamp", symbol: "lamp.desk.fill", size: 76, x: 230, y: -65,
                       tint: CozyPalette.green, accessibilityLabel: "Reading lamp")
    ]

    static func shopItems(policy: BalancePolicy) -> [ShopItem] {
        [
            ShopItem(id: "plant", name: "Window plant", symbol: "leaf.fill", cost: policy.itemCosts["plant"] ?? 35),
            ShopItem(id: "cushion", name: "Soft cushion", symbol: "circle.grid.2x2.fill", cost: policy.itemCosts["cushion"] ?? 50),
            ShopItem(id: "lamp", name: "Reading lamp", symbol: "lamp.desk.fill", cost: policy.itemCosts["lamp"] ?? 75)
        ]
    }
}
