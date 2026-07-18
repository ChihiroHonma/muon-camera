import Foundation
import Capacitor
import AudioToolbox

/**
 * マナーモード連動シャッター音プラグイン。
 *
 * 実装方式の変遷（重要な学び）:
 * 1. AudioServicesPlaySystemSound(1108) — 標準カメラのシャッター音ID。
 *    「保護されたサウンド」でサイレントスイッチを無視して常に鳴るためNG。
 * 2. AVAudioPlayer + AVAudioSession(.ambient) — Web版カメラでは機能したが、
 *    ネイティブカメラはマイク入力を持つため iOS が音声セッションを録音系
 *    (.playAndRecord = サイレントスイッチ無視)へ自動構成し、.ambient 設定が
 *    上書き/拒否されて連動しなくなった。またカテゴリ変更はカメラセッションを
 *    中断させる副作用もある。
 * 3. 【現方式】自作 shutter.wav から AudioServicesCreateSystemSoundID で
 *    カスタムシステムサウンドを作成して再生する。
 *    - システムサウンド(UIサウンド層)は着信/サイレントスイッチに自動で従う
 *      (1108が鳴り続けたのは「保護されたID」だったためで、カスタム音は従う)
 *    - AVAudioSession のカテゴリに依存せず、一切触らないため、
 *      カメラセッション(マイク入力あり)と干渉しない
 */
@objc(ShutterSoundPlugin)
public class ShutterSoundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShutterSoundPlugin"
    public let jsName = "ShutterSound"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise)
    ]

    private var soundID: SystemSoundID = 0

    @objc func play(_ call: CAPPluginCall) {
        if soundID == 0 {
            guard let url = Bundle.main.url(forResource: "shutter", withExtension: "wav") else {
                call.reject("shutter.wav not found in app bundle")
                return
            }
            let status = AudioServicesCreateSystemSoundID(url as CFURL, &soundID)
            guard status == kAudioServicesNoError, soundID != 0 else {
                call.reject("Failed to create system sound (status: \(status))")
                return
            }
        }
        AudioServicesPlaySystemSound(soundID)
        call.resolve()
    }

    deinit {
        if soundID != 0 {
            AudioServicesDisposeSystemSoundID(soundID)
        }
    }
}
