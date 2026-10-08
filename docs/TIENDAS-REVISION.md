# CSD App — Reviewer notes (CI11) — English

Paste into **App Store Connect → App Review Information → Notes** and **Google Play → App access / Review notes**.

## About the app
CSD App is the **internal field companion** for the staff of Constructora SD, a construction
company in the Dominican Republic. It is **not a consumer app**: accounts are created by the
company's administrators — there is **no public sign-up**. Field workers use it to record
fuel, material delivery notes, routes, site logs, inventory and vehicle usage, and it works
fully **offline**.

## Demo account (sign in with these)
A dedicated **DEMO SITE** with fictional data (invalid national IDs `000-…`, vehicle `DEMO-001`)
is isolated by the `revisor_tiendas` role — the reviewer never sees real employee data.

- Supervisor demo: `revision.tiendas@constructorasd.com` / password: **[Xaviel pega aquí]**
- Driver demo (for location/tracking): `revision.chofer@constructorasd.com` / password: **[Xaviel pega aquí]**

> Passwords are stored in `.env.local` (`STORE_REVIEW_*`) by Xaviel; **never commit them.**
> There is no 2FA. A device PIN / biometrics may be offered inside the app — you can **skip**
> it on first launch and use the password login.

## How to test key features
1. **Login:** use the demo account above (email + password).
2. **Camera:** Transporte → Registrar combustible → take a photo of a receipt (any paper).
3. **Chofer state + location:** open the driver demo → Transporte → tap the status chip →
   choose "Disponible". You'll see the **location prominent disclosure** sheet first. Accept it
   to see the persistent "location active" notification. Choose **"Inactivo"** to turn tracking
   off immediately.
4. **AI assistant (optional):** open **Compa** → the **AI consent sheet** appears before the
   first message (names Anthropic / Groq-OpenAI). "Ahora no" keeps the rest of the app working.
5. **Offline:** turn on Airplane Mode → capture anything → it's queued and syncs on reconnect.

## Why background location
Drivers share their location **only while on shift** so the Fleet team can see where the vehicle
is and log routes. The **driver chooses** when they're available or inactive (status chip);
**Inactivo or logout turns GPS off**. A prominent disclosure is shown **before** requesting
"Allow all the time". This is work-related tracking **the employee is aware of** (persistent
notification), not hidden monitoring.

## "Entrar como" (impersonation)
An admin-only internal support tool that lets an administrator view the app as another user for
troubleshooting. It is **not** available to the demo reviewer accounts.

---

## Google Play background-location video (≤30 s) — script for Xaviel to record
Record on a real phone (play channel build):
1. Open app → login as `revision.chofer`.
2. Tap the status chip → choose **Disponible** → the **disclosure sheet** appears
   (shows "ubicación" + "también cuando la app está cerrada o en segundo plano").
3. Tap **"Aceptar y continuar"** → grant the location permission ("Allow all the time").
4. Show the **persistent notification** "CSD App — ubicación activa. Estado: Disponible".
5. Press Home (app in background) → show it is still reporting (open Seguimiento on another
   device or show the notification persists).
6. Reopen → tap status → **Inactivo** → the notification disappears (tracking off).
