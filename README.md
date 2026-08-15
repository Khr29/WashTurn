# WashTurn

## Backend (`/server`)

```
cd server
npm install
cp .env.example .env   # fill in MONGO_URI / JWT_SECRET
npm run dev
```

Verified end-to-end (register/login, household create/join, schedule owner-only
updates, the full turn lifecycle including the concurrent emergency-claim race
guard, activity log) against a local MongoDB instance. `npm test` runs the
automated Jest/Supertest suite covering the same race condition.

Push notifications are optional: without `FIREBASE_SERVICE_ACCOUNT_PATH` set,
the server logs a warning and skips sending — nothing else is affected.

## Mobile app (`/app`)

**Not yet buildable/runnable in this environment** — the Flutter SDK isn't
installed here, so this code has not been run, built, or tested on a device
or emulator. It was written to match the backend's verified API contracts
exactly, but treat it as unverified until built.

To pick it up:

```
cd app
flutter create .        # generates the missing android/ios/etc. platform folders
flutter pub get
flutterfire configure   # generates lib/firebase_options.dart — required for push notifications
flutter run
```

`flutter create .` is required first: this repo only has `pubspec.yaml` and
`lib/` (the platform-specific scaffolding was never generated, since that
requires the Flutter SDK). Run from inside `/app` so it adds the platform
folders in place without touching the existing `lib/` source.

Notes:
- `core/api/api_config.dart` picks `http://10.0.2.2:4000/api` on the Android
  emulator and `http://localhost:4000/api` elsewhere. For a physical device,
  override with `flutter run --dart-define=API_BASE_URL=http://<lan-ip>:4000/api`.
- The app runs fine without Firebase configured — `main.dart` swallows the
  init failure — but push notifications won't work until `flutterfire configure`
  has been run for a real Firebase project.
- State management is Riverpod; see `lib/core/state/`.
