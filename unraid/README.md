# Publishing Hearth to Unraid Community Applications

`hearth.xml` is the CA template; `hearth-icon.png` is its icon, rendered from
`src/app/icon.svg` at 256×256 in a single teal that reads on both the light and dark Unraid
themes (the app's own favicon switches colour by media query, which a PNG cannot do).

## Before submitting

CA's policies require a few things that only a human with accounts can do.

1. **A GitHub repository, on an account with two-factor authentication enabled.** CA reads
   templates from GitHub and the policy is explicit about 2FA. The simplest arrangement is to
   mirror this GitLab repository to GitHub (GitLab → Settings → Repository → Mirroring
   repositories) so the template travels with the code and cannot drift from it.

2. **A support thread on the Unraid forums.** The template's `Support` field must point at it,
   and CA expects that to be where users go — so it has to exist before submission.

3. **A publicly pullable image.** Make the GitLab project public so
   `registry.gitlab.com/hearth-prm/hearth:latest` can be pulled anonymously, and check the
   Container Registry's own visibility setting as well as the project's.

4. **Fill in the two `REPLACE_ME` markers** in `hearth.xml`:
   - `REPLACE_ME_UNRAID_FORUM_THREAD` → the support thread URL
   - `REPLACE_ME_RAW_GITHUB_URL` → e.g.
     `https://raw.githubusercontent.com/<user>/hearth/main` (both `TemplateURL` and `Icon`)

5. **Submit the template repository through the form on the Unraid forums**, not by messaging a
   moderator — the policy asks for the form, and says responses usually come within 48 hours.

## What the policies require, that this template already does

- **Open source.** AGPL-3.0, and the template itself is in the repository.
- **No code injection.** The template runs the container and nothing else: no `PostArgs`, no
  shell commands. Attempting otherwise gets an author's whole repository blacklisted.
- **A real description and a static icon.** No animated icons are allowed.
- **A distinct application name**, and no duplicate submission for the same image.
- **No referral or affiliate links.** The donate fields are empty.

## The two-container shape

CA templates describe one container, and Hearth is an app plus Postgres. The template installs
the app and takes a `DATABASE_URL`; the user installs PostgreSQL 16 from CA first. This is the
same arrangement Paperless-ngx and Nextcloud use on Unraid, and the Overview says so in its
first lines, because somebody who misses it gets a container that restarts for ever.

One thing worth stating in the support thread: **Hearth keeps everything in Postgres, including
contact photos.** There is no appdata path to map and nothing to lose by recreating the
container — but the database is the whole install, so that is what needs backing up.

## Warning worth repeating in the support thread

The compose file pins `name: hearth`, so **two Hearth checkouts on one host are the same Compose
project.** Cloning the repo somewhere else on a server that already runs Hearth and typing
`docker compose up -d` does not create a second stack — it adopts and recreates the running one
with the new directory's `.env`. Anybody testing an upgrade before applying it will do exactly
this, so the answer is worth saying out loud: `docker compose -p hearth-test up -d`.

Data survives (Postgres is a bind mount, and `down -v` only touches named volumes) but the
containers come back on the wrong configuration, and a stale locally-built image can leave an
old app running against a newer database. The version in the footer is what makes that visible.

## Testing the template before submitting

Community Applications can install a template from a local file: put `hearth.xml` in
`/boot/config/plugins/dockerMan/templates-user/` on the Unraid server and it appears under
**Docker → Add Container → Template**. Worth doing once end to end — including on a machine
that has never run Hearth — because the defaults and descriptions are the entire user
experience for somebody installing it.
