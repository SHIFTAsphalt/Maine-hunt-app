# Maine Hunt Map: setup

This folder is the whole app. It has to be served from a free HTTPS host, because phones only allow GPS on secure links.

## Option A: GitHub Pages (works from your phone, free, no expiry)
1. Unzip `maine-hunt-map.zip` (in the iPhone Files app, tap the zip).
2. Sign up or log in at github.com and create a **new repository**, for example `huntmap`. Make it **Public**.
3. In the repo, tap **Add file › Upload files** and select every file from the unzipped folder: index.html, app.js, geo.js, data.js, sw.js, manifest.webmanifest and the 3 icon PNGs. Then **Commit**.
4. Go to repo **Settings › Pages**, set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
5. After about a minute your app is at `https://YOUR-NAME.github.io/huntmap/`.

## Option B: Netlify Drop (easiest from a computer)
Go to https://app.netlify.com/drop and drag the unzipped **folder** onto the page. You get a link right away. Make a free account so the site doesn't expire.

## Install on the phone
Open the link in **Safari**, then tap **Share › Add to Home Screen**. Always open the app from that icon. Allow **Location** when it asks, and tap **Turn on compass** on the Compass screen once.

## Before you head out
- Open **More › Offline maps** on Wi-Fi and save your hunting area, in each map style you use.
- Pan around your area once with your land layers on, so they're saved for offline use too.
- WMD lines and legal hours work with no signal. Weather needs signal; when you're offline you see the last forecast it loaded.

## Updating for next season
All season dates and rules live in **data.js** (`seasons` and `rules`). Edit them there and upload the new file.
