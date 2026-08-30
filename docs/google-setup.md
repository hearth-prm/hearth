# Connecting Hearth to Google

Hearth pushes your contacts to Google Contacts and your events to Google Calendar, so what you
keep here shows up on your phone. To do that it needs permission from Google, and Google grants
permission to *applications* rather than to people — so you have to create an application, which
takes about ten minutes and is free.

**You are creating your own private application, used only by you.** Hearth cannot ship a shared
one: Google requires an application to list every exact web address it will be used from, and
your Hearth is at an address nobody else can predict. That turns out to be a good thing — because
your application has one user, it never needs Google's review process, which is the expensive
part.

Everything below happens once. If you get lost, the shape of it is: turn on two APIs, describe
your app, create a credential, paste two values into Hearth.

---

## Before you start

You need to know the address you will reach Hearth at, including `https://` and no trailing
slash. For example:

```
https://hearth.example.com
```

If you are only trying Hearth on your own machine, `http://localhost:3000` works and this guide
still applies.

That address must match `AUTH_URL` in your `.env` **exactly** — Google compares it character for
character, and a mismatch is the single most common reason sign-in fails.

---

## 1. Create a project

1. Go to <https://console.cloud.google.com> and sign in with the Google account whose contacts
   you want Hearth to manage.
2. In the project picker at the top, choose **New project**. Call it `Hearth`. Create it, then
   make sure the picker now shows it — everything below applies to the selected project.

## 2. Turn on the two APIs

**APIs & Services → Library**, then search for and **Enable** each of:

- **Google People API** — contacts
- **Google Calendar API** — events

If you plan to email thank-you notes from Hearth, also enable **Gmail API**. Most people should
skip it; see [Thank-you emails](#thank-you-emails-optional) at the end.

Nothing works until these are enabled, and the error when they are not is unhelpful, so it is
worth going back to check if something later fails.

## 3. Describe the application

**APIs & Services → OAuth consent screen.**

- **User type: External.** "Internal" only exists if you pay for Google Workspace, and it is
  the better option if you have it — see [If you have Google Workspace](#if-you-have-google-workspace).
- **App name:** `Hearth`. This is what you will see on the consent screen, so name it something
  you will recognise in a year.
- **User support email:** your own address.
- **Developer contact:** your own address.

Leave the rest blank. Save and continue.

### Scopes

Click **Add or remove scopes** and add, by pasting each into the filter box:

| Scope | What it lets Hearth do |
|---|---|
| `.../auth/contacts` | Create and update your Google contacts |
| `.../auth/calendar.events` | Create and update events, and invite guests |
| `.../auth/calendar.readonly` | List your calendars, so you can choose which one to use |
| `.../auth/gmail.send` | **Optional.** Send a thank-you list as you |

Hearth asks for narrow scopes on purpose: `calendar.events` rather than full `calendar`, so a
stolen token cannot delete a calendar, and `gmail.send` rather than anything that could read
your mail.

### Test users

Add your own Google address, and the address of anyone else who will use your Hearth.

## 4. Publish the app — do not skip this

Still on the **OAuth consent screen** page, press **Publish app** and confirm.

**This step is not optional, and skipping it is the bug you will otherwise report.** While the app
is in "Testing", Google expires its refresh tokens after **seven days** — so Hearth signs in
fine, syncs for a week, and then quietly stops until you reconnect. Every week. For ever.

Publishing does *not* mean submitting anything to Google or making anything public. It means
moving out of Testing. You will not be asked for a review, because you have not asked to be
verified.

The cost is one scary screen: because your app is unverified, the first time you sign in Google
will say **"Google hasn't verified this app"**. Click **Advanced**, then **Go to Hearth
(unsafe)**. It is your app, on your project, reaching your data. Nobody else ever sees this
screen, because nobody else uses your app.

## 5. Create the credential

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

- **Application type:** Web application
- **Name:** `Hearth`
- **Authorised redirect URIs → Add URI:**

```
https://hearth.example.com/api/auth/callback/google
```

That is your `AUTH_URL` with **`/api/auth/callback/google`** on the end. Nothing else. If you
will also use Hearth at `http://localhost:3000` while setting up, add that one too — a client
can hold several.

Create it. Google shows a **Client ID** and a **Client secret**. The secret is shown once; copy
both now.

## 6. Tell Hearth

In your `.env`:

```
AUTH_URL=https://hearth.example.com
AUTH_GOOGLE_ID=1234567890-abcdefg.apps.googleusercontent.com
AUTH_GOOGLE_SECRET=GOCSPX-your-secret-here
```

Restart: `docker compose up -d`.

Then sign in, click through the unverified-app warning, and grant the permissions. **Settings**
will show what Google actually granted — if anything is missing it says so and offers a
reconnect.

---

## When it does not work

| What you see | What it means |
|---|---|
| `redirect_uri_mismatch` | The redirect URI in Google is not exactly `AUTH_URL` + `/api/auth/callback/google`. Check for a trailing slash, `http` vs `https`, and `www`. |
| Sign-in works, then "Reconnect Google" every week | The app is still in **Testing**. Publish it — step 4. |
| "Access blocked: this app's request is invalid" | Usually a redirect URI that was saved but not yet propagated. Wait a minute and retry; Google's changes are not always instant. |
| "Google hasn't verified this app" | Expected, for ever. Advanced → Go to Hearth (unsafe). |
| Settings says sync is not possible | A scope was not granted, or was declined on the consent screen. Reconnect and accept all of them. |
| `Hearth is misconfigured` on the sign-in page | `AUTH_SECRET`, `AUTH_GOOGLE_ID` or `AUTH_GOOGLE_SECRET` is missing from the environment the container actually sees. `docker compose config` shows what it got. |
| That Google account is not allowed | Nothing to do with Google — the address is not in `HEARTH_ALLOWED_EMAILS`. See the README. |

**Settings → Google** reports exactly which scopes the stored grant covers, whether a refresh
token exists (without one, background sync cannot survive an hour), and when the last sync ran.
It is the first place to look, because it describes what Google actually said rather than what
was requested.

---

## Thank-you emails (optional)

Hearth can email a thank-you list as you, which needs `gmail.send`. It is **off by default** and
the scope is not requested unless you switch it on:

```
HEARTH_ENABLE_MAIL=true
```

…then reconnect Google so the new scope is granted.

Off by default because Gmail scopes are the category Google controls most tightly, and most
people running a relationship manager will never email a thank-you from it. Asking every install
to grant mail-sending access in order to sync contacts is the wrong trade — the consent screen is
where somebody decides whether to trust this, and it should not be carrying a permission the
install has no use for.

## If you have Google Workspace

If the account belongs to your own Workspace domain, choose **Internal** rather than External at
step 3. An internal app has no publishing status, no seven-day token expiry, no unverified
warning and no test-user list. Step 4 does not apply. It is strictly better, and available only
to Workspace accounts.

## Verification, and why you do not need it

Google's verification process — privacy policy, demo video, domain ownership, per-scope
justification, and for some scopes an annual third-party security assessment — exists for apps
with many users who do not know the developer. Yours has one user who is you.

An unverified app in production keeps working indefinitely. The warning screen is the whole
price. If you ever did want it verified, note that Gmail scopes raise the bar considerably, which
is the other reason `gmail.send` is opt-in here.

## What Hearth does with the access

- **Contacts** — one-way. Hearth pushes to Google and never reads your Google contacts back,
  except when you explicitly run an import.
- **Calendar** — events Hearth owns are pushed; guest RSVPs are read back.
- **Gmail** — only when you press send on a thank-you list, and only send.
- Nothing is sent anywhere else. There is no telemetry, and no Hearth server: the only remote
  services involved are Google, and — if you configure them — your own Ollama and your chosen
  address-lookup provider.
