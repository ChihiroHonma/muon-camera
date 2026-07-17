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
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise)
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
        guard let fileData = Data(base64Encoded: base64) else {
            call.reject("Failed to decode base64 data")
            return
        }

        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photo library access not authorized")
                return
            }

            if type == "photo" {
                self.savePhoto(fileData, call: call)
            } else {
                self.saveVideo(fileData, call: call)
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
                call.reject("Failed to save photo: \(error?.localizedDescription ?? "unknown error")")
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
            call.reject("Failed to write temp video file: \(error.localizedDescription)")
            return
        }

        PHPhotoLibrary.shared().performChanges({
            PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: tmpURL)
        }) { success, error in
            try? FileManager.default.removeItem(at: tmpURL)
            if success {
                call.resolve()
            } else {
                call.reject("Failed to save video: \(error?.localizedDescription ?? "unknown error")")
            }
        }
    }
}
