import Foundation
import Capacitor
import AVFoundation

/**
 * マナーモード連動シャッター音プラグイン。
 *
 * 実機検証の結果、AudioServicesPlaySystemSound(1108)（標準カメラのシャッター音ID）は
 * サイレントスイッチを無視して常に鳴ることが判明した（Appleが盗撮防止のため意図的に
 * 消せない設計にしている可能性が高い）。
 *
 * 対策として、独自の音声ファイル(shutter.wav)を AVAudioPlayer で再生し、
 * AVAudioSession のカテゴリを .ambient に設定する方式に変更した。
 * .ambient はサイレントスイッチに従って自動的に消音されるカテゴリ。
 */
@objc(ShutterSoundPlugin)
public class ShutterSoundPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShutterSoundPlugin"
    public let jsName = "ShutterSound"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareRecording", returnType: CAPPluginReturnPromise)
    ]

    private var player: AVAudioPlayer?

    @objc func play(_ call: CAPPluginCall) {
        guard let url = Bundle.main.url(forResource: "shutter", withExtension: "wav") else {
            call.reject("shutter.wav not found in app bundle")
            return
        }

        do {
            try AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true, options: [.notifyOthersOnDeactivation])

            player = try AVAudioPlayer(contentsOf: url)
            player?.play()
            call.resolve()
        } catch {
            call.reject("Failed to play shutter sound: \(error.localizedDescription)")
        }
    }

    /**
     * 動画録画の直前に呼び、音声セッションを録音可能な .playAndRecord に切り替える。
     * シャッター音再生で .ambient (再生専用) に変わったまま録画すると音声が無音に
     * なるため、録画前に録音可能なカテゴリへ戻す。
     */
    @objc func prepareRecording(_ call: CAPPluginCall) {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playAndRecord,
                mode: .videoRecording,
                options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
            call.resolve()
        } catch {
            call.reject("Failed to prepare recording session: \(error.localizedDescription)")
        }
    }
}
