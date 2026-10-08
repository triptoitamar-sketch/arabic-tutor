# Arabic Tutor

A hands-free spoken Arabic tutor, meant to be used while driving: one tap to
start a lesson, pure voice conversation from there, one tap to end it. Teaches
colloquial Palestinian/Levantine Arabic (as spoken by Arabic-speaking citizens
of Israel), using Gemini's native-audio Live API, and remembers what was
covered last time via Firebase Firestore.

## One-time setup

### 1. Gemini API key
Get a key from [Google AI Studio](https://aistudio.google.com/apikey). In
Google AI Studio / Cloud Console, consider restricting the key to the
Generative Language API only and setting a usage/billing cap — see
**Security notes** below for why.

You don't put the key in any file. Open the deployed app, tap **Settings**,
and paste it in — it's saved in that browser's `localStorage`.

### 2. Firebase project (for remembering lessons between drives)
1. Create a project at the [Firebase console](https://console.firebase.google.com/).
2. Add a Web app to it (no need for Hosting/Auth/Analytics — just Firestore).
3. Enable **Firestore Database** (production mode is fine — rules below lock it down).
4. Deploy `firestore.rules` from this repo to that project:
   ```
   npm install -g firebase-tools   # one-time
   firebase login
   firebase use --add              # pick your project, give it an alias
   firebase deploy --only firestore:rules
   ```
5. Copy the web app's config (Project settings → Your apps → SDK setup and
   configuration) into `src/config/firebaseConfig.js`, replacing the
   `REPLACE_ME` placeholders. This config is not secret — see **Security notes**.

### 3. Verify the model id
Model ids for Gemini's native-audio Live API occasionally change (previews
get replaced). Check `src/config/constants.js`'s `NATIVE_AUDIO_MODEL_ID`
against the current id listed at https://ai.google.dev/gemini-api/docs/live.

## Local development

```
npm install
npm run dev
```

Open the printed localhost URL, add your API key under Settings, and run a
full mock lesson using your computer's mic/speakers before ever trying it in
the car.

## Deploying to GitHub Pages

1. Push this repo to GitHub (as `arabic-tutor`, matching `vite.config.js`'s
   `base` path — or update that path if you name it differently).
2. In the repo's Settings → Pages, set **Source** to "GitHub Actions".
3. Push to `main` — `.github/workflows/deploy.yml` builds and deploys
   automatically. Your app will be live at
   `https://<your-username>.github.io/arabic-tutor/`.

## Security notes

- **Gemini API key**: stored in browser `localStorage` and used directly from
  the browser to connect to the Live API. This is a deliberate tradeoff to
  avoid running any backend server — it means the key is visible to anyone
  with access to that browser/device. Mitigate by restricting the key's scope
  and setting a billing/usage cap in Google AI Studio.
- **Firebase config**: not secret by Firebase's own design; access control is
  via `firestore.rules`, which is scoped to exactly one document
  (`lessons/latest`). Anyone who found your config could read or overwrite
  that one doc (lesson notes only — nothing sensitive), but nothing else in
  your Firebase project.

## Safety note

Test the whole flow — including Start, End, and a deliberately dropped
connection (e.g. toggling airplane mode) — while parked before relying on
this while actually driving. The hands-free design doesn't change local laws
around phone use while driving; keep the phone mounted and avoid touching the
screen once you're moving.
