// WatchSender.swift
// Sample code for the watchOS app (WatchKit Extension) to record audio and send to the iPhone via WatchConnectivity

import Foundation
import WatchKit
import WatchConnectivity
import AVFoundation

class WatchSender: NSObject, WKExtensionDelegate, AVAudioRecorderDelegate, WCSessionDelegate {
    var recorder: AVAudioRecorder?
    var session: WCSession? = WCSession.isSupported() ? WCSession.default : nil

    override init() {
        super.init()
        session?.delegate = self
        session?.activate()
    }

    func startRecordingAndSend() {
        // record a short file (3-6s)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("watch-recording.wav")
        do {
            recorder = try AVAudioRecorder(url: tmp, settings: settings)
            recorder?.delegate = self
            recorder?.record(forDuration: 5.0)
        } catch {
            print("recorder start failed: \(error)")
            return
        }
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        guard flag else { return }
        let url = recorder.url
        do {
            let data = try Data(contentsOf: url)
            // send as transferFile for reliability
            if let sess = session, sess.isPaired, sess.isReachable {
                sess.transferFile(url, metadata: ["filename": url.lastPathComponent])
            } else if let sess = session, sess.isPaired {
                // try background transfer
                sess.transferFile(url, metadata: ["filename": url.lastPathComponent])
            }
        } catch {
            print("read file failed: \(error)")
        }
    }

    // WCSessionDelegate minimal
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { }
    func session(_ session: WCSession, didReceiveMessage message: [String : Any]) { }
    func session(_ session: WCSession, didTransferFile file: WCSessionFile) {
        // not used on watch side
    }
}
