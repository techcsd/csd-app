# CsdApp

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.16.

## Secrets & local setup (read before building Android)

Secrets are **never** committed. Two files are required locally and are gitignored:

- **`.env.local`** (repo root) — Supabase URL, anon key, service_role/secret keys, Vercel OIDC. The
  `service_role`/secret keys must live **only** here (or in CI secrets), never in app source. The Supabase
  **anon** key that ships inside the app (`src/environments/environment*.ts`) is public by design — it is
  protected by RLS and is expected to be readable in the client bundle.
- **`android/app/google-services.json`** — Firebase/Android config (project id + Android **API key**). This
  file is gitignored (AG1). To set it up:
  1. Copy the template: `cp android/app/google-services.json.example android/app/google-services.json`
  2. Fill in the real values from the Firebase console (Project settings → Your apps → `com.constructorasd.csdapp`),
     **or** download the file directly from Firebase and drop it in place.
  3. The Android API key **must be restricted** in Google Cloud Console to the app's package name
     (`com.constructorasd.csdapp`) + release SHA-1/SHA-256 certificate fingerprints.
  - CI: provide the file contents as a repository secret and write it out before `npm run apk`
    (e.g. `echo "$GOOGLE_SERVICES_JSON" > android/app/google-services.json`).
  - If the file is absent, the build still succeeds but Firebase push notifications are disabled
    (`android/app/build.gradle` applies the google-services plugin only when the file exists).

`npm run build` does not need either file; only the Android/APK build consumes `google-services.json`.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
