# Beacon for Gmail

A free, private desktop app for Gmail on Windows. The important stuff, first.

**Website:** https://beaconmailapp.github.io · **Download:** see [Releases](../../releases/latest)

## What it does

- **For You**: learns which email matters to you (who you write to, what you open, star and delete) and keeps the rest in Everything else. Press `+` or `-` to teach it.
- **Clean up**: your inbox grouped by sender. Archive, delete or unsubscribe from a whole sender in one click.
- **Calendar**: day, week and month views of Google Calendar, with add, edit and invite answers.
- **Built for the desktop**: tray icon, alerts for important mail only, dark and light themes, several Gmail accounts, keyboard shortcuts, schedule send, snooze, undo send, paste screenshots.

## Privacy

Beacon runs on your computer and talks directly to Google's Gmail and Calendar APIs. There is no Beacon server, no analytics and no tracking. Sign-ins are stored encrypted by Windows. See the [privacy policy](https://beaconmailapp.github.io/privacy.html).

## Install

1. Download `Beacon-x.y.z-Windows.zip` from [Releases](../../releases/latest) and unzip it.
2. Run `Beacon.exe` inside it and click **Install**. If Windows SmartScreen appears, click *More info*, then *Run anyway* (the app is not code signed).
3. On first start Beacon walks you through making your own free Google key (about 10 minutes, once):
   - Create a Google Cloud project, turn on the Gmail API (and Google Calendar API).
   - Google Auth Platform: set it up as **External**, then **Publish app** on the Audience page.
   - Clients: **Create client** > **Desktop app** > **Download JSON**.
   - In Beacon click **Load my Google key file**, then sign in. Google shows "hasn't verified this app" because the key is yours: click *Advanced*, then continue.

## Build from source

Requires Node.js on Windows.

```
npm install
npm start          # run from source (put your key at src/client.json or load it in the app)
npm run build      # makes dist/Beacon-x.y.z-Windows.zip
```

`src/client.json` (your Google key) is ignored by git. Never commit it.

## License

MIT. Beacon is an independent project and is not made by or affiliated with Google. Gmail is a trademark of Google LLC.
