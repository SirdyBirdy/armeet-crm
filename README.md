# Desk

A private dashboard for tracking therapy inquiries and clients. Dark, mobile-friendly, no build step.

The app (HTML, CSS, JS) holds no client data. Data lives in a separate private GitHub repo and is read and written through the GitHub API with a token.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | All styling |
| `app.js` | Logic, rendering, GitHub sync |
| `data.example.json` | Shape of the data file. Reference only, do not deploy with real data |

## Setup

### 1. Create the private data repo

1. GitHub: **New repository**, name it `desk-data`, set it to **Private**.
2. Tick "Add a README" so the repo is not empty.

Do not put the app files in this repo.

### 2. Create a token

1. GitHub: **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. Resource owner: your account.
3. Repository access: **Only select repositories**, pick `desk-data`.
4. Permissions: **Contents: Read and write**. Nothing else.
5. Set an expiry (90 days is reasonable) and copy the token. It starts with `github_pat_`.

### 3. Host the app

1. Create a second repo, e.g. `desk`. It can be public because it holds no client data.
2. Upload `index.html`, `style.css`, `app.js`.
3. **Settings > Pages**: deploy from the `main` branch, root folder.
4. Open `https://<username>.github.io/desk/`.

`index.html` carries a `noindex` tag so search engines skip it. For extra privacy, use a non-obvious repo name.

### 4. Connect

1. Open the app and tap the **Local** pill at the top right.
2. Enter:
   - Repo: `<username>/desk-data`
   - File path: `data.json`
   - Token: the `github_pat_...` value
3. Tap **Save**. The pill turns green and says **Synced**. `data.json` is created in `desk-data` on your first change.

Repeat step 4 on each device. The token is stored in that browser only.

### 5. Add to your phone home screen

- **iPhone**: Safari > Share > Add to Home Screen.
- **Android**: Chrome > menu > Add to Home screen.

## Daily use

- Tap **+** to add someone. Name is enough.
- Tap a person to open them. Use **Contacted today**, **Session done** or **Became client**, and set a follow-up with the chips.
- **Today** shows who needs attention and why.
- A person with a follow-up date is flagged on that date. Without one, they are flagged when:
  - Inquiry: status is New, or no contact for the set number of days
  - Client: no session for the set number of days

Thresholds are in **Settings**.

## Keyboard shortcuts

Press `?` in the app to see this list.

| Key | Action |
|---|---|
| `N` | New person |
| `T` `I` `C` or `1` `2` `3` | Today, Inquiries, Clients |
| `/` | Search |
| `J` `K` or arrow keys | Move selection down and up |
| `Enter` | Open selected person |
| `W` | WhatsApp the selected person |
| `,` | Settings |
| `Esc` | Close the open sheet. Edits to a person are saved |
| `Ctrl` or `Cmd` + `Enter` | Save and close |

Inside a person: `D` contacted today, `S` session done, `W` WhatsApp with the default template. Shortcuts are ignored while typing in a field.

## WhatsApp

- Each person has a **WhatsApp number**. If it is empty, a phone number in the contact field is used.
- 10-digit numbers get the default country code (91). Change it in **Settings**.
- Rows in the lists show a green WhatsApp button. It opens a chat with a message chosen from the person's status: reply for new inquiries, form reminder when the form is pending, follow-up for other inquiries, check-in for clients.
- In a person's sheet, **Message on WhatsApp** lists every template for that person. Tap one to open WhatsApp with the text filled in. You still press send.
- Opening a message logs it, sets last contact to today, and moves a new inquiry to Replied. Send Form moves the status to Form sent.
- Edit templates and set your intake form link in **Settings**. `{name}` becomes the first name and `{form}` becomes the form link.

## Sync behavior

- Changes save automatically about a second after you stop editing.
- If two devices edit at once, records are merged per person by last-edited time.
- If offline, changes stay in the browser cache and sync on the next change.
- The status pill shows **Synced**, **Saving**, **Offline** or **Not saved**.

## Backups

- **Settings > Export backup** downloads the full JSON.
- **Settings > Import backup** restores from a file. Import replaces current data.
- Every save is a commit in `desk-data`, so the repo history is also a backup.

## Extending

Everything is in `app.js`. Common edits:

- Inquiry statuses: `INQ_STATUS`
- Client statuses: `CL_STATUS`
- Sources: `SOURCES`
- Default thresholds and follow-up chips: `DEFAULTS`
- Colors: CSS variables at the top of `style.css`

Records are plain JSON objects, so new fields can be added without migrating old data. Missing fields read as empty.

## Security notes

- Use a token scoped to the data repo only, with an expiry.
- Anyone with the token can read and write client data. Do not share it or paste it anywhere else.
- Revoke the token from GitHub settings if a device is lost.
- Use initials or first names plus a phone number rather than full clinical detail in notes.
