import Foundation
import Capacitor
import AudioToolbox

/**
 * マナーモード連動シャッター音プラグイン。
 *
 * AudioServicesPlaySystemSound はシステムサウンド用のAPIで、
 * 端末のサイレントスイッチ（マナーモード）がONの場合はOSが自動的に鳴動を抑制する。
 * これにより「マナーモード時のみ無音、通常時はシャッター音あり」という
 * Capera等の実績アプリと同様の挙動を狙う。
 *
 * 注意: この挙動はAppleの非公式仕様（コミュニティで広く確認されている経験則）であり、
 * 実機での動作確認が必須。DESIGN.md「Phase 2」参照。
 */
@objc(ShutterSoundPlugin)
public class ShutterSoundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShutterSoundPlugin"
    public let jsName = "ShutterSound"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise)
    ]

    // iOS標準カメラのシャッター音に割り当てられているシステムサウンドID
    private static let shutterSoundID: SystemSoundID = 1108

    @objc func play(_ call: CAPPluginCall) {
        AudioServicesPlaySystemSound(ShutterSoundPlugin.shutterSoundID)
        call.resolve()
    }
}
