// iPhoneForwarder.swift
// Sample code for the iPhone companion app that receives files from the watch and forwards them to the Ella backend

import Foundation
import WatchConnectivity

class iPhoneForwarder: NSObject, WCSessionDelegate {
    let hostUrl: URL
    let watchToken: String?
    var session: WCSession

    init(host: URL, token: String?) {
        self.hostUrl = host
        self.watchToken = token
        self.session = WCSession.default
        super.init()
        self.session.delegate = self
        self.session.activate()
    }

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        // read the file from file.fileURL and upload
        DispatchQueue.global(qos: .utility).async {
            do {
                let data = try Data(contentsOf: file.fileURL)
                let b64 = data.base64EncodedString()
                var req = URLRequest(url: self.hostUrl.appendingPathComponent("/api/watch/audio"))
                req.httpMethod = "POST"
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                if let token = self.watchToken { req.setValue(token, forHTTPHeaderField: "X-Watch-Token") }
                let payload: [String: Any] = ["filename": file.fileURL.lastPathComponent, "data": b64]
                req.httpBody = try JSONSerialization.data(withJSONObject: payload, options: [])
                let (d, resp) = try URLSession.shared.synchronousDataTask(with: req)
                print("upload result: \(String(describing: resp)) data: \(String(describing: d))")
            } catch {
                print("forward failed: \(error)")
            }
        }
    }

    // minimal required WCSessionDelegate
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { }
    func sessionDidBecomeInactive(_ session: WCSession) { }
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}

// helper sync wrapper (for brevity in sample only)
extension URLSession {
    func synchronousDataTask(with request: URLRequest) throws -> (Data?, URLResponse?) {
        var data: Data?
        var response: URLResponse?
        var error: Error?
        let sem = DispatchSemaphore(value: 0)
        let task = self.dataTask(with: request) { d, r, e in data = d; response = r; error = e; sem.signal() }
        task.resume()
        sem.wait()
        if let err = error { throw err }
        return (data, response)
    }
}
