// CarThingHelper — location, calendar, reminders and photos for the bridge. Lives in an .app
// bundle so macOS can ask for (and remember) Location Services, Calendars, Reminders and Photos
// permission under its own name.
//
// stdin, one JSON object per line:
//   {"id":1,"cmd":"status"}
//   {"id":2,"cmd":"location"}                          prompts for permission the first time
//   {"id":3,"cmd":"events","from":<ms>,"to":<ms>}      prompts for permission the first time
//   {"id":4,"cmd":"calendars"}
//   {"id":5,"cmd":"reminders","lists":[<id>]|null}     prompts for permission the first time
//   {"id":6,"cmd":"reminderLists"}
//   {"id":7,"cmd":"photo","album":<id>|null,"index":n}  prompts for permission the first time
//   {"id":8,"cmd":"albums"}
// stdout, one JSON object per line: replies carry the request's "id"; unsolicited notices
// carry "event": "ready" | "calendarChanged" (events or reminders) | "locationAuthorization" |
// "photosChanged".

import AppKit
import CoreImage
import CoreLocation
import EventKit
import Foundation
import ImageIO
import Photos

// Be our own "responsible process" so permissions attach to this app, not to node/launchd.
// Re-execs in place (same pid and stdio) with the private disclaim spawn attribute.
func disclaimResponsibility() {
  guard getenv("CARTHING_HELPER_DISCLAIMED") == nil,
    let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "responsibility_spawnattrs_setdisclaim"),
    let path = Bundle.main.executablePath
  else { return }
  typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETEXEC))
  _ = unsafeBitCast(sym, to: SetDisclaim.self)(&attr, 1)
  setenv("CARTHING_HELPER_DISCLAIMED", "1", 1)
  var argv: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
  posix_spawn(nil, path, nil, &attr, &argv, environ)
}
disclaimResponsibility()
setvbuf(stdout, nil, _IOLBF, 0)

func send(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
}

func hex(_ color: NSColor?) -> String {
  guard let c = color?.usingColorSpace(.sRGB) else { return "#8e8e93" }
  return String(format: "#%02x%02x%02x", Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
}

/// A video-call link from the event's location, URL or notes, for events whose location doesn't
/// say where the meeting is (the link is often only in the invite's notes).
let callPattern = try! NSRegularExpression(
  pattern: #"https?://([a-z0-9-]+\.)*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|facetime\.apple\.com)(/[^\s<>"')]*)?"#,
  options: [.caseInsensitive])
func callLink(_ ev: EKEvent) -> String? {
  for text in [ev.location, ev.url?.absoluteString, ev.notes].compactMap({ $0 }) {
    let range = NSRange(text.startIndex..., in: text)
    if let match = callPattern.firstMatch(in: text, range: range), let r = Range(match.range, in: text) {
      return String(text[r])
    }
  }
  return nil
}

// The device's screen, which a photo is fitted or cropped to.
let screenWidth = 800, screenHeight = 480
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

/// Draws `image` at `rect` into a width×height sRGB bitmap (a rect overhanging it crops).
func render(_ image: CGImage, width: Int, height: Int, at rect: CGRect) -> CGImage? {
  guard let ctx = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: srgb,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
  else { return nil }
  ctx.interpolationQuality = .high
  ctx.draw(image, in: rect)
  return ctx.makeImage()
}

/// The rect that fills width×height with `image`, centred, cropping whatever overhangs.
func coverRect(_ image: CGImage, width: Int, height: Int) -> CGRect {
  let w = CGFloat(image.width), h = CGFloat(image.height)
  let scale = max(CGFloat(width) / w, CGFloat(height) / h)
  return CGRect(x: (CGFloat(width) - w * scale) / 2, y: (CGFloat(height) - h * scale) / 2, width: w * scale, height: h * scale)
}

func writeJPEG(_ image: CGImage, to url: URL) -> Bool {
  guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil) else { return false }
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
  return CGImageDestinationFinalize(dest)
}

final class Helper: NSObject, CLLocationManagerDelegate, PHPhotoLibraryChangeObserver {
  let store = EKEventStore()
  let locationManager = CLLocationManager()
  let geocoder = CLGeocoder()
  var locationWaiters: [Any] = []
  var askedForCalendar = false
  var askedForReminders = false
  var askedForPhotos = false
  var watchingPhotos = false
  // Exporting a photo (and blurring its backdrop) happens off the main queue, one at a time, so
  // other commands aren't held up behind an iCloud download.
  let photoQueue = DispatchQueue(label: "com.carthing.helper.photo")
  let ciContext = CIContext(options: [.workingColorSpace: srgb, .outputColorSpace: srgb])
  lazy var photoDir: URL = {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("carthing-photos", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }()

  override init() {
    super.init()
    locationManager.delegate = self
    locationManager.desiredAccuracy = kCLLocationAccuracyKilometer
    // Fires for reminder changes too: the bridge's reminders feed listens for it as well.
    NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { _ in
      send(["event": "calendarChanged"])
    }
    watchPhotos()
  }

  var locationStatus: String {
    switch locationManager.authorizationStatus {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "authorized"
    }
  }

  var calendarStatus: String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .writeOnly: return "writeOnly"
    case .fullAccess: return "authorized"
    @unknown default: return "unknown"
    }
  }

  var remindersStatus: String {
    switch EKEventStore.authorizationStatus(for: .reminder) {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .writeOnly: return "writeOnly"
    case .fullAccess: return "authorized"
    @unknown default: return "unknown"
    }
  }

  var photosStatus: String {
    switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .limited: return "limited"
    case .authorized: return "authorized"
    @unknown default: return "unknown"
    }
  }

  var photosReadable: Bool {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    return status == .authorized || status == .limited
  }

  func handle(_ msg: [String: Any]) {
    let id = msg["id"] ?? NSNull()
    switch msg["cmd"] as? String {
    case "status":
      send([
        "id": id, "ok": true, "location": locationStatus, "calendar": calendarStatus,
        "reminders": remindersStatus, "photos": photosStatus,
      ])
    case "location":
      location(id)
    case "events":
      events(id, from: msg["from"] as? Double ?? 0, to: msg["to"] as? Double ?? 0)
    case "calendars":
      calendars(id)
    case "reminders":
      reminders(id, lists: msg["lists"] as? [String])
    case "reminderLists":
      reminderLists(id)
    case "photo":
      photo(id, album: msg["album"] as? String, index: msg["index"] as? Int ?? 0)
    case "albums":
      albums(id)
    default:
      send(["id": id, "ok": false, "error": "unknown command"])
    }
  }

  // MARK: Location

  func location(_ id: Any) {
    switch locationManager.authorizationStatus {
    case .denied, .restricted:
      send(["id": id, "ok": false, "status": locationStatus])
    case .notDetermined:
      locationWaiters.append(id)
      locationManager.requestWhenInUseAuthorization()
    default:
      locationWaiters.append(id)
      locationManager.requestLocation()
    }
  }

  func flushLocation(_ reply: [String: Any]) {
    let ids = locationWaiters
    locationWaiters = []
    for id in ids { send(reply.merging(["id": id]) { $1 }) }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    send(["event": "locationAuthorization", "status": locationStatus])
    guard !locationWaiters.isEmpty else { return }
    switch manager.authorizationStatus {
    case .notDetermined: break
    case .denied, .restricted: flushLocation(["ok": false, "status": locationStatus])
    default: manager.requestLocation()
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let loc = locations.last, !locationWaiters.isEmpty else { return }
    geocoder.reverseGeocodeLocation(loc) { placemarks, _ in
      let p = placemarks?.first
      self.flushLocation([
        "ok": true, "status": "authorized",
        "lat": loc.coordinate.latitude, "lon": loc.coordinate.longitude,
        "accuracy": loc.horizontalAccuracy,
        "name": p?.locality ?? p?.subAdministrativeArea ?? p?.administrativeArea ?? "",
        "region": p?.administrativeArea ?? "", "country": p?.isoCountryCode ?? "",
      ])
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    flushLocation(["ok": false, "status": "unavailable", "error": error.localizedDescription])
  }

  // MARK: Calendar

  func events(_ id: Any, from: Double, to: Double) {
    let status = EKEventStore.authorizationStatus(for: .event)
    if status == .notDetermined && !askedForCalendar {
      askedForCalendar = true
      store.requestFullAccessToEvents { _, _ in
        DispatchQueue.main.async { self.events(id, from: from, to: to) }
      }
      return
    }
    guard status == .fullAccess else {
      send(["id": id, "ok": false, "status": calendarStatus])
      return
    }
    let predicate = store.predicateForEvents(
      withStart: Date(timeIntervalSince1970: from / 1000), end: Date(timeIntervalSince1970: to / 1000), calendars: nil)
    let events = store.events(matching: predicate)
      .filter { ev in
        ev.status != .canceled
          && !(ev.attendees?.contains { $0.isCurrentUser && $0.participantStatus == .declined } ?? false)
      }
      .sorted { $0.startDate < $1.startDate }
      .prefix(80)
      .map { ev -> [String: Any] in
        [
          "title": ev.title ?? "", "location": ev.location ?? "",
          "start": ev.startDate.timeIntervalSince1970 * 1000, "end": ev.endDate.timeIntervalSince1970 * 1000,
          "allDay": ev.isAllDay, "calendar": ev.calendar.title, "color": hex(ev.calendar.color),
          "calendarId": ev.calendar.calendarIdentifier,
          "call": callLink(ev) ?? "",
          // The event's alerts, as ms before its start (negative = after). Location-based
          // ("when I leave") alerts have no time, so they're left out.
          "alerts": (ev.alarms ?? []).filter { $0.proximity == .none }.map { alarm -> Double in
            if let date = alarm.absoluteDate { return (ev.startDate.timeIntervalSince(date)) * 1000 }
            return -alarm.relativeOffset * 1000
          },
        ]
      }
    send(["id": id, "ok": true, "status": "authorized", "events": Array(events)])
  }

  /// Every event calendar the Mac knows about, so the settings page can offer them as choices.
  func calendars(_ id: Any) {
    guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
      send(["id": id, "ok": false, "status": calendarStatus])
      return
    }
    let list = store.calendars(for: .event)
      .sorted { ($0.source.title, $0.title) < ($1.source.title, $1.title) }
      .map { cal -> [String: Any] in
        ["id": cal.calendarIdentifier, "title": cal.title, "color": hex(cal.color), "account": cal.source.title]
      }
    send(["id": id, "ok": true, "status": "authorized", "calendars": list])
  }

  // MARK: Reminders

  /// Incomplete reminders from the chosen lists (nil: every list): dated ones first, soonest due
  /// first, then the undated in the order they were made.
  func reminders(_ id: Any, lists: [String]?) {
    let status = EKEventStore.authorizationStatus(for: .reminder)
    if status == .notDetermined && !askedForReminders {
      askedForReminders = true
      store.requestFullAccessToReminders { _, _ in
        DispatchQueue.main.async { self.reminders(id, lists: lists) }
      }
      return
    }
    guard status == .fullAccess else {
      send(["id": id, "ok": false, "status": remindersStatus])
      return
    }
    let calendars = lists.map { ids in store.calendars(for: .reminder).filter { ids.contains($0.calendarIdentifier) } }
    // An empty array would read as "no filter" to EventKit; none chosen means none shown.
    if calendars?.isEmpty == true {
      send(["id": id, "ok": true, "status": "authorized", "reminders": []])
      return
    }
    let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
    store.fetchReminders(matching: predicate) { found in
      // EventKit calls back on its own queue; stdout and the store belong to the main one.
      DispatchQueue.main.async {
        let dated = (found ?? []).map { r -> (EKReminder, Date?) in
          (r, r.dueDateComponents.flatMap { Calendar.current.date(from: $0) })
        }
        let sorted = dated.sorted { a, b in
          switch (a.1, b.1) {
          case let (x?, y?): return x < y
          case (.some, nil): return true
          case (nil, .some): return false
          case (nil, nil): return (a.0.creationDate ?? .distantPast) < (b.0.creationDate ?? .distantPast)
          }
        }
        let items = sorted.prefix(60).map { item -> [String: Any] in
          let (r, due) = item
          return [
            "id": r.calendarItemIdentifier, "title": r.title ?? "",
            "due": due.map { $0.timeIntervalSince1970 * 1000 as Any } ?? NSNull(),
            "allDay": due != nil && r.dueDateComponents?.hour == nil,
            "priority": r.priority,
            "list": r.calendar.title, "listId": r.calendar.calendarIdentifier, "color": hex(r.calendar.color),
          ]
        }
        // total counts past the 60 sent, so the screen's "+N more" and count stay true.
        send(["id": id, "ok": true, "status": "authorized", "reminders": Array(items), "total": sorted.count])
      }
    }
  }

  /// Every reminder list on the Mac, for the settings page's choices.
  func reminderLists(_ id: Any) {
    guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
      send(["id": id, "ok": false, "status": remindersStatus])
      return
    }
    let list = store.calendars(for: .reminder)
      .sorted { ($0.source.title, $0.title) < ($1.source.title, $1.title) }
      .map { cal -> [String: Any] in
        ["id": cal.calendarIdentifier, "title": cal.title, "color": hex(cal.color), "account": cal.source.title]
      }
    send(["id": id, "ok": true, "status": "authorized", "lists": list])
  }

  // MARK: Photos

  /// Change notices only once we may read the library: registering before that can prompt.
  func watchPhotos() {
    guard !watchingPhotos, photosReadable else { return }
    watchingPhotos = true
    PHPhotoLibrary.shared().register(self)
  }

  func photoLibraryDidChange(_ changeInstance: PHChange) {
    DispatchQueue.main.async { send(["event": "photosChanged"]) }
  }

  var favorites: PHAssetCollection? {
    PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .smartAlbumFavorites, options: nil).firstObject
  }

  /// Still images only, oldest first, so an index means the same photo until the album changes.
  func imageOptions(sorted: Bool) -> PHFetchOptions {
    let options = PHFetchOptions()
    options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
    if sorted { options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)] }
    return options
  }

  /// The albums the settings page offers: Favorites, Recents, then your albums, then shared ones.
  func albums(_ id: Any) {
    guard photosReadable else {
      send(["id": id, "ok": false, "status": photosStatus])
      return
    }
    watchPhotos()  // access granted in System Settings since we started
    let images = imageOptions(sorted: false)
    var list: [[String: Any]] = []
    func add(_ c: PHAssetCollection?, kind: String, keepEmpty: Bool = true) {
      guard let c else { return }
      let count = PHAsset.fetchAssets(in: c, options: images).count
      if count == 0 && !keepEmpty { return }
      list.append(["id": c.localIdentifier, "title": c.localizedTitle ?? "", "count": count, "kind": kind])
    }
    func fetch(_ type: PHAssetCollectionType, _ subtype: PHAssetCollectionSubtype) -> [PHAssetCollection] {
      var found: [PHAssetCollection] = []
      PHAssetCollection.fetchAssetCollections(with: type, subtype: subtype, options: nil).enumerateObjects { c, _, _ in found.append(c) }
      return found.sorted { ($0.localizedTitle ?? "").localizedStandardCompare($1.localizedTitle ?? "") == .orderedAscending }
    }
    add(favorites, kind: "smart")
    add(PHAssetCollection.fetchAssetCollections(with: .smartAlbum, subtype: .smartAlbumUserLibrary, options: nil).firstObject,
      kind: "smart", keepEmpty: false)
    for c in fetch(.album, .albumRegular) { add(c, kind: "user") }
    for c in fetch(.album, .albumCloudShared) { add(c, kind: "shared") }
    send(["id": id, "ok": true, "status": photosStatus, "albums": list])
  }

  /// Photo `index` (wrapped to the album's size) of the album (nil: Favorites), written out ready
  /// for the screen. Wide photos are cropped to fill it; the rest are fitted inside it, with a
  /// blurred, cropped copy to go behind them.
  func photo(_ id: Any, album: String?, index: Int) {
    if PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined && !askedForPhotos {
      askedForPhotos = true
      PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in
        DispatchQueue.main.async {
          self.watchPhotos()
          self.photo(id, album: album, index: index)
        }
      }
      return
    }
    guard photosReadable else {
      send(["id": id, "ok": false, "status": photosStatus])
      return
    }
    watchPhotos()
    let collection = album.map { PHAssetCollection.fetchAssetCollections(withLocalIdentifiers: [$0], options: nil).firstObject } ?? favorites
    guard let collection else {
      send(["id": id, "ok": false, "status": photosStatus, "error": "album not found"])
      return
    }
    let assets = PHAsset.fetchAssets(in: collection, options: imageOptions(sorted: true))
    let count = assets.count
    guard count > 0 else {
      send(["id": id, "ok": true, "status": photosStatus, "count": 0, "album": collection.localizedTitle ?? ""])
      return
    }
    let i = ((index % count) + count) % count
    let asset = assets.object(at: i)
    let options = PHImageRequestOptions()
    options.isNetworkAccessAllowed = true  // originals that only live in iCloud
    options.deliveryMode = .highQualityFormat  // one callback, never a blurry placeholder first
    options.resizeMode = .fast
    let base: [String: Any] = [
      "id": id, "count": count, "index": i, "album": collection.localizedTitle ?? "",
      "date": asset.creationDate.map { $0.timeIntervalSince1970 * 1000 as Any } ?? NSNull(),
    ]
    // PhotoKit hands back the photo already turned upright, so EXIF orientation needs nothing more.
    PHImageManager.default().requestImage(
      for: asset, targetSize: CGSize(width: 1600, height: 1600), contentMode: .aspectFit, options: options
    ) { image, info in
      self.photoQueue.async {
        var reply = base
        if let cg = image?.cgImage(forProposedRect: nil, context: nil, hints: nil), let out = self.layout(cg) {
          reply["ok"] = true
          reply["status"] = "authorized"
          reply.merge(out) { $1 }
        } else {
          reply["ok"] = false
          reply["status"] = "error"
          reply["error"] = (info?[PHImageErrorKey] as? Error)?.localizedDescription
            ?? ((info?[PHImageResultIsInCloudKey] as? Bool) == true ? "could not download from iCloud" : "could not read the photo")
        }
        DispatchQueue.main.async { send(reply) }
      }
    }
  }

  /// Writes the screen-ready JPEG(s) for `image`: {path, blurPath, width, height}.
  func layout(_ image: CGImage) -> [String: Any]? {
    let name = UUID().uuidString
    let path = photoDir.appendingPathComponent("\(name).jpg")
    let w = CGFloat(image.width), h = CGFloat(image.height)
    guard w > 0, h > 0 else { return nil }
    if w / h >= 1.2 {
      guard let cover = render(image, width: screenWidth, height: screenHeight, at: coverRect(image, width: screenWidth, height: screenHeight)),
        writeJPEG(cover, to: path)
      else { return nil }
      return ["path": path.path, "blurPath": NSNull(), "width": screenWidth, "height": screenHeight]
    }
    // Fitted: portrait photos are the screen's height, squarer ones whichever side runs out first.
    let scale = min(CGFloat(screenWidth) / w, CGFloat(screenHeight) / h)
    let fw = max(1, Int((w * scale).rounded())), fh = max(1, Int((h * scale).rounded()))
    guard let fitted = render(image, width: fw, height: fh, at: CGRect(x: 0, y: 0, width: fw, height: fh)),
      writeJPEG(fitted, to: path)
    else { return nil }
    let blurURL = photoDir.appendingPathComponent("\(name).blur.jpg")
    let blurPath: Any = backdrop(image, to: blurURL) ? blurURL.path : NSNull()
    return ["path": path.path, "blurPath": blurPath, "width": fw, "height": fh]
  }

  /// The photo filling the screen, blurred: drawn at a quarter size first, where the blur is cheap
  /// and loses nothing, then scaled back up to the screen.
  func backdrop(_ image: CGImage, to url: URL) -> Bool {
    let small = 4, sw = screenWidth / small, sh = screenHeight / small
    guard let tiny = render(image, width: sw, height: sh, at: coverRect(image, width: sw, height: sh)) else { return false }
    let blurred = CIImage(cgImage: tiny).clampedToExtent()
      .applyingGaussianBlur(sigma: 40 / Double(small))
      .transformed(by: CGAffineTransform(scaleX: CGFloat(small), y: CGFloat(small)))
      .cropped(to: CGRect(x: 0, y: 0, width: screenWidth, height: screenHeight))
    guard let out = ciContext.createCGImage(blurred, from: blurred.extent) else { return false }
    return writeJPEG(out, to: url)
  }
}

let helper = Helper()
send([
  "event": "ready", "location": helper.locationStatus, "calendar": helper.calendarStatus,
  "reminders": helper.remindersStatus, "photos": helper.photosStatus,
])

Thread {
  while let line = readLine() {
    guard let data = line.data(using: .utf8),
      let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { continue }
    DispatchQueue.main.async { helper.handle(msg) }
  }
  exit(0)  // stdin closed: the bridge went away
}.start()

RunLoop.main.run()
