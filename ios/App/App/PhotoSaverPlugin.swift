import Foundation
import Capacitor
import Photos

/**
 * 撮影した写真・動画を共有シートを介さず直接フォトライブラリに保存するプラグイン。
 *
 * JS側から Base64 エンコードしたデータと種別(photo/video)を受け取り、
 * PHPhotoLibrary.performChanges で直接カメラロールに追加する。
 * NSPhotoLibraryAddUsageDescription（Info.plist設定済み）が前提。
 */
@objc(PhotoSaverPlugin)
public class PhotoSaverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoSaverPlugin"
    public let jsName = "PhotoSaver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise)
    ]

    @objc func save(_ call: CAPPluginCall) {
        guard let base64 = call.getString("data") else {
            call.reject("Missing 'data' parameter")
            return
        }
        guard let type = call.getString("type"), type == "photo" || type == "video" else {
            call.reject("Missing or invalid 'type' parameter (expected 'photo' or 'video')")
            return
        }
        // ignoreUnknownCharacters: 改行・空白が混入していてもデコードできるようにする。
        // 失敗時は受信した base64 長を返し、サイズ起因(bridge途中で切断)かを診断できるようにする。
        guard let fileData = Data(base64Encoded: base64, options: [.ignoreUnknownCharacters]) else {
            call.reject("デコード失敗(受信base64長=\(base64.count))")
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            switch status {
            case .authorized, .limited:
                if type == "photo" {
                    self.savePhoto(fileData, call: call)
                } else {
                    self.saveVideo(fileData, call: call)
                }
            case .denied, .restricted:
                call.reject("写真へのアクセスが拒否されています。設定＞ZERO Camera＞写真 を許可してください")
            case .notDetermined:
                call.reject("写真へのアクセス許可が未確定です。もう一度お試しください")
            @unknown default:
                call.reject("写真へのアクセス状態が不明です")
            }
        }
    }

    /**
     * ファイルパスから写真ライブラリへ保存する（ネイティブ録画の動画など、
     * base64をbridgeに通すと壊れる大きなファイル向け）。
     */
    @objc func saveFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else {
            call.reject("Missing 'path' parameter")
            return
        }
        guard let type = call.getString("type"), type == "photo" || type == "video" else {
            call.reject("Missing or invalid 'type' parameter")
            return
        }
        let fileURL: URL
        if path.hasPrefix("file://") {
            fileURL = URL(string: path) ?? URL(fileURLWithPath: path)
        } else {
            fileURL = URL(fileURLWithPath: path)
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            switch status {
            case .authorized, .limited:
                PHPhotoLibrary.shared().performChanges({
                    if type == "video" {
                        PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
                    } else {
                        PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: fileURL)
                    }
                }) { success, error in
                    if success {
                        call.resolve()
                    } else {
                        call.reject("保存に失敗: \(error?.localizedDescription ?? "unknown error")")
                    }
                }
            case .denied, .restricted:
                call.reject("写真へのアクセスが拒否されています。設定＞ZERO Camera＞写真 を許可してください")
            default:
                call.reject("写真へのアクセス許可が未確定です。もう一度お試しください")
            }
        }
    }

    private func savePhoto(_ data: Data, call: CAPPluginCall) {
        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .photo, data: data, options: nil)
        }) { success, error in
            if success {
                call.resolve()
            } else {
                call.reject("写真の保存に失敗: \(error?.localizedDescription ?? "unknown error")")
            }
        }
    }

    private func saveVideo(_ data: Data, call: CAPPluginCall) {
        let tmpURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("mp4")

        do {
            try data.write(to: tmpURL)
        } catch {
            call.reject("一時ファイル書き込み失敗: \(error.localizedDescription)")
            return
        }

        PHPhotoLibrary.shared().performChanges({
            PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: tmpURL)
        }) { success, error in
            try? FileManager.default.removeItem(at: tmpURL)
            if success {
                call.resolve()
            } else {
                call.reject("動画の保存に失敗: \(error?.localizedDescription ?? "unknown error")")
            }
        }
    }
}
