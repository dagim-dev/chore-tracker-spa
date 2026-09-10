# Roommate Chore Tracker

A client-side single page application for tracking household chores among four roommates.

## Stack

- HTML5, CSS3, Vanilla JavaScript (ES6+)
- Browser `localStorage` for persistence
- No backend or build step

## Features

- Filter chores by roommate
- Mark chores as complete or in-progress (public)
- Admin PIN gate for adding and deleting chores
- Three fixed categories: Kitchen, Common Room, Bathroom

## Local Development

Open `index.html` directly in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Admin Access

Use the Admin Login button and enter the PIN configured in `script.js` (`ADMIN_PIN`).

> **Note:** The PIN is visible in client-side source code. This is a household-trust deterrent, not real security.
