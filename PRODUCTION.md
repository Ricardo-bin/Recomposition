# Recomposition - production notes (Phase 7A)

Production-readiness hardening, **not** a penetration test or security certification.

## Manual Firebase Console actions (cannot be done from this repo)
1. Deploy the rules: `firebase deploy --only firestore:rules` (file: `firestore.rules`).
2. Authentication -> Settings -> **Authorized domains**: add the production domain (and the Vercel preview domain if used).
3. Authentication -> Settings -> **User actions**: turn ON *Email enumeration protection*.
4. Authentication -> Settings -> **Password policy**: require a minimum length of 8 (enforces server-side what the app only checks in the browser).
5. Google Cloud Console -> APIs & Services -> Credentials: restrict the **Browser API key** to HTTP referrers (production domain) and to the APIs the app uses (Identity Toolkit, Token Service, Firestore).
6. Consider turning on **App Check** (not required for launch).
7. Run `npm run test:rules` once on a machine with Java (Firebase emulator) and confirm it passes.

## Manual hosting (Vercel) actions
1. Deploy; `vercel.json` adds the security headers and `.vercelignore` keeps tests/tooling out of the deployed site.
2. Open the deployed site with DevTools open and sign in with Google and with email/password. The CSP is shipped as **Content-Security-Policy-Report-Only**: check the console for "Content Security Policy" reports and fix any that appear.
3. When there are no reports, rename the header key in `vercel.json` from `Content-Security-Policy-Report-Only` to `Content-Security-Policy` (the hashes of the inline scripts in `index.html` are checked by `tests/hosting.test.mjs`; if you edit an inline script the hash must be regenerated).
4. Excel export: SheetJS is fetched only when Excel export is pressed. To remove the CDN entirely, download the file, put it in the project (e.g. `vendor/xlsx.full.min.js`), set `SHEETJS_SRC` in `sheetjsLoader.js`, and drop `https://cdn.sheetjs.com` from the CSP `script-src`. To keep the CDN, set `SHEETJS_INTEGRITY` to the file's `sha384-...` hash.

## Not covered here
Account deletion (out of scope by decision), email verification (would change the sign-in flow), field-level Firestore validation, App Check, penetration testing.
