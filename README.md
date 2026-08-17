# WashTurn 🧺

*A washing-machine treaty, minus the diplomacy.*

## The problem

If you've ever shared a washing machine with roommates, family, or any other human who also owns clothes, you know exactly how this goes. One machine. Several people. Zero coordination. Someone starts a load at 11pm the night before an early flight. Someone "forgets" it's their turn for the third week running. Someone starts a fight in the group chat that has nothing to do with laundry and everything to do with laundry.

WashTurn exists because one household got tired of solving this with sticky notes, group texts, and vague resentment, and built the thing instead. It's a small, real app — not a portfolio toy — built to answer one specific, unglamorous, universal question: *whose turn is it, and can I please just start my wash without a negotiation.*

## What it actually is

WashTurn is a household washing-machine scheduler: a Flutter app talking to a Node/Express/MongoDB backend. You create a household, invite the people whose socks end up in your machine, set a weekly schedule, and from then on the app tracks — accurately, in real time, for everyone — who owns today's turn, what state the machine is in, and who's allowed to do what.

It doesn't talk to your actual machine, and it isn't trying to be a smart-home platform. It's a coordination layer for the humans, because historically, the humans have been the hard part.

## How turns actually work

Every household has a weekly schedule — one person assigned per day of the week, set once by the household owner. Each day, that schedule "materializes" into a turn for that date, and the turn moves through a small, deliberate set of states:

| Status | What it means |
|---|---|
| `PENDING` | Today's turn exists, nobody's touched it yet |
| `IN_USE` | Someone's washing right now |
| `RELEASED` | The scheduled person doesn't need today's turn — it's up for grabs |
| `CLAIMED` | Someone grabbed a released turn and is about to start |
| `COMPLETED` | Done. Machine's free again |
| `EXPIRED` | Nobody used it, and the day moved on without them |

If it's your day, you hit **Start Wash** and go. If you don't need it — out of clothes, out of town, whatever — you **Release** it instead, which opens the machine up for anyone else in the household to **Claim** for emergency use. There's one deliberate rule here: you can't release your own turn and then quietly reclaim it five minutes later. That would defeat the entire point of releasing it.

## Transfers and requests

Ownership of a turn can change hands two ways, for two different social situations:

- **Give Turn** — you're the owner, and you just hand it to someone directly. No approval step. You picked them, it's done.
- **Request This Turn** — you *want* someone else's turn, so you politely ask. They see the request and can accept it (it's yours now) or reject it (it's still theirs). If more than one person asks for the same turn, whichever request gets accepted wins and the rest quietly dissolve — nobody ends up with a turn that was promised to two people at once.

## More than one wash a day

The weekly schedule assigns *a* turn per day, not a hard ceiling. Once a turn is actually finished, the machine is open again the same day — so if your turn's done and someone else in the house needs a quick second load, that's just a new turn, not a rule violation. What the app won't allow is two turns "in flight" on the machine at the same time, for the obvious reason that it only has one drum.

## The drying-favor economy

This started as a half-joke and turned out to be genuinely useful: washing and drying are two different favors, and WashTurn treats them that way. Need someone to pull your clothes out of the dryer, or hang them up while you're out? You can ask a specific housemate directly — completely independent of whatever's happening with the machine itself. They accept, they do it, they mark it done, and the app quietly keeps score: a running per-person ledger of who owes whom a drying favor. Return the favor later and the ledger nets itself back down to zero automatically — no money, no spreadsheet, just a small, honest record of who's been pulling their weight.

## Notifications, without the noise

Push notifications (via Firebase Cloud Messaging) cover the moments that actually matter: your turn is today or tomorrow, someone started or finished a wash, someone released a turn or claimed one for an emergency, someone requested your turn (or accepted, rejected, or handed you theirs), and the drying-favor equivalents of all of the above. Every category is individually toggleable from your profile, and — mercifully — you never get notified about your own actions. Nobody needs a push notification congratulating them on starting their own laundry.

## The tech stack

**Backend** — Node.js + Express, MongoDB via Mongoose, JWT-based auth with bcrypt password hashing, the Firebase Admin SDK for push delivery, `node-cron` for the daily housekeeping job (expiring stale turns, sending reminders), and a Jest/Supertest suite that exercises the concurrency-sensitive paths, not just the happy ones.

**Mobile app** — Flutter, with Riverpod for state management, `flutter_secure_storage` for the auth token (Keychain/Keystore-backed, never stored in plain text), `firebase_messaging` and `firebase_core` for push, and `share_plus` for sharing the household invite code.

## How it fits together

At the center of everything is one idea: **the machine's status is never stored on its own — it's always derived from today's turn.** There's no separate "machine state" that can quietly drift out of sync with what's actually happening; if the turn says `IN_USE`, the machine reads `IN_USE`, full stop. Households are joined via a six-character invite code, the owner sets the weekly schedule, and everything downstream — turns, transfers, requests, drying favors, notifications — is layered on top of that one small, honest source of truth.

Every API route checks that the person asking is actually a member of the household in question before touching anything belonging to it. And the handful of operations where two people could plausibly race each other — claiming the same released turn, accepting the same request — are built as atomic database operations specifically so that exactly one of them wins cleanly, instead of both "succeeding" and leaving the data somewhere that doesn't make sense.

## Running it locally

### Backend

```bash
cd server
npm install
cp .env.example .env   # fill in MONGO_URI / JWT_SECRET at minimum
npm run dev
```

Needs a MongoDB instance running locally (`mongodb://localhost:27017` by default — adjust `MONGO_URI` if yours lives elsewhere). Push notifications are optional: leave `FIREBASE_SERVICE_ACCOUNT_PATH` unset and the server logs a warning and skips sending — everything else works exactly the same.

Run the automated test suite with:

```bash
npm test
```

### Flutter app

```bash
cd app
flutter pub get
flutter run
```

A few things worth knowing:

- The API base URL auto-selects `http://10.0.2.2:4000/api` on the Android emulator and `http://localhost:4000/api` everywhere else. Running on a physical device on the same network? Point it at your machine's LAN IP instead: `flutter run --dart-define=API_BASE_URL=http://<your-lan-ip>:4000/api`.
- Push notifications need a real Firebase project — run `flutterfire configure` to generate `lib/firebase_options.dart`. Skip that step and the app runs completely normally; you just won't get pushes.
- `flutter analyze` and `flutter test` are both clean if you want to sanity-check your setup before diving in.

---

That's WashTurn: not glamorous, not trying to be — just a straightforward answer to a fight that shouldn't have to happen every single week.
