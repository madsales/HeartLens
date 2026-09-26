# HeartLens mobile

The Android and iOS app, built with Expo and React Native from one TypeScript codebase. It talks to the HeartLens server in the repo root, which holds the API key and does the analysis.

## Screens

- **Analyze** – paste their profile, your conversation, and a note about you. The draft is saved on the device as you type.
- **Your read** – the full analysis: summary, interests with evidence, engagement, communication style, opener angles with a Copy button, things to avoid, and safety cautions.
- **History** – the last 30 reads, stored only on the device. Tap one to reopen it, or clear them all.
- **Settings** – the server URL, with a connection test.

## Run it in development

1. Start the server in the repo root (`npm start`, or `npm run dev` for mock mode without an API key).
2. In this directory:

   ```bash
   npm install
   npx expo start
   ```

3. Scan the QR code with Expo Go (Android or iOS), or press `a` / `i` for an emulator or simulator.

The app guesses the server address from the Expo dev host, so if the server runs on the same machine as `expo start` on port 3000, nothing needs configuring. Otherwise set the URL in Settings. Android emulators reach the host machine at `http://10.0.2.2:3000`.

## Build the real apps

Builds run in the cloud with EAS, so no local Xcode or Android Studio is needed. Set your deployed server URL in `eas.json` first (`EXPO_PUBLIC_API_URL`), then:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform android   # installable APK
npx eas-cli@latest build --profile production --platform all    # store builds
npx eas-cli@latest submit --platform all
```

Bundle identifiers are `com.heartlens.app` on both platforms (`app.json`). Change them before submitting if you own a different domain.

## Checks

```bash
npx tsc --noEmit                                  # typecheck
npx expo export --platform android --platform ios # bundle both platforms without a device
```

## Layout

```
app/            screens (Expo Router): index, results, history, settings, _layout
src/api.ts      request to POST /api/analyze and the Analysis type
src/storage.ts  AsyncStorage: server URL, draft, history
src/components  shared UI and the result renderer
src/theme.ts    colors shared with the website
assets/         icons and splash
```
