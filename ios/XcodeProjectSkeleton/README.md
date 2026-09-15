Xcode Project Skeleton (iOS + watchOS)

This folder provides a minimal skeleton you can open in Xcode and use to create a watchOS + iOS companion app for Ella. It intentionally omits Xcode project files (.xcodeproj) because those are best generated in Xcode itself; the files below are ready to be added into a new project.

Steps to use:
1. Open Xcode → Create a new Project → App (iOS) and also add a watchOS target (Watch App for iOS App).
2. Replace or add the Swift files from this folder into the appropriate targets (iOS app target, WatchKit App, WatchKit Extension).
3. Configure App Groups and WatchConnectivity entitlements for the app IDs.
4. Set the iPhone app to store the Ella backend URL and the WATCH_TOKEN; the Watch app will send recorded audio to the iPhone which forwards to the backend.

Files included:
- iOSApp/AppDelegate.swift
- iOSApp/ViewController.swift
- WatchApp/InterfaceController.swift
- WatchExtension/ExtensionDelegate.swift
- Use the earlier WatchSender.swift and iPhoneForwarder.swift snippets for recording and transfer logic.

If you want, I can also generate a ready-to-open Xcode project (requires an Xcodeproj template and bundle IDs). Tell me whether you want a ready .xcodeproj, or prefer to import these files into Xcode yourself.