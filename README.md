# Roommate Chore Tracker

A client-side single page application for tracking household chores among four roommates, synced in real time via Firebase Firestore.

## Stack

- HTML5, CSS3, Vanilla JavaScript (ES modules)
- Firebase Firestore for shared data sync
- Netlify for static hosting

## Features

- Real-time chore sync across all devices
- Roommate leaderboard with progress rings
- Filter chores by roommate
- In Progress / Done status (public)
- Chore suggestions (public submit/delete, admin promote)
- Admin PIN gate for adding and deleting chores
- Three fixed categories: Kitchen, Common Room, Bathroom

## Firebase Setup

1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Firestore Database** (start in test mode for development)
3. Register a **Web app** and copy the `firebaseConfig` object
4. Paste your config into `firebase-config.js` (see `firebase-config.example.js` for the template)
5. Publish Firestore rules from `firestore.rules`:
   - Firebase console → Firestore → Rules → paste → **Publish**

## Local Development

Firebase requires serving over HTTP (not `file://`):

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deployment (Netlify)

Push to GitHub — Netlify auto-deploys. No build step needed.

| Setting | Value |
|---|---|
| Build command | *(blank)* |
| Publish directory | `.` |

Make sure `firebase-config.js` contains your real Firebase config before deploying.

## Admin Access

Click **AM** and enter the PIN configured in `script.js` (`ADMIN_PIN`).

> **Note:** The PIN is visible in client-side source code. This is a household-trust deterrent, not real security.

## Data Migration

On first load after upgrading, any existing `localStorage` data is automatically uploaded to Firestore once, then cleared locally.
