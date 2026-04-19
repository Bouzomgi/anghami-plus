# Anghami Plus — Chrome Extension

Target: `https://kalimat.anghami.com/lyrics/{song-id}`

## DOM Targeting Notes

The site is Next.js with CSS-in-JS — class names are hashed and unstable. Target elements by:
- Structural selectors (`main > div:first-child`)
- Image `src` containing `anghcdn.co` (album art)
- Link `href` containing `/artist/` or `/album/`

Page structure (single-column, no sidebars): purple header → album cover section → lyrics → app download promo → footer.

---

## Feature 1: Page Cleanup & Layout

**Keep:** purple header, album cover section (art + title + artist name only), Arabic lyrics.

**Hide:** listen/like counts and "Listen Now" button within the album section. Everything after the lyrics (download promo, footer).

The album cover section should scroll naturally — not sticky or fixed.

**Font:** replace the Arabic lyrics font with "Amiri" or "Noto Naskh Arabic" (Google Fonts), injected via stylesheet.

**Mobile:** use relative units; don't hardcode widths.

---

## Feature 2: English Translation

Render an "English Translation" section below the lyrics.

Invoke via background script: `POST` to Lambda Function URL with `{ "action": "translate", "lyrics": "..." }` → returns `{ "result": "..." }`. Request must be SigV4-signed with the IAM credentials from the options page.

---

## Feature 3: Harakat Toggle

A toggle button near the lyrics ("Show Harakat" / "Hide Harakat"). When on, replace the lyrics display with a harakated version.

**Harakat spec — IMPORTANT:**
- ✅ Include: kasra (ِ), damma (ُ), shadda (ّ), sukun (ْ), tanwin kasra (ٍ), tanwin damma (ٌ)
- ❌ Exclude: fatha (َ) and tanwin fatha (ً)

Invoke: `{ "action": "harakat", "lyrics": "..." }` → same Lambda endpoint as translation.

---

## Architecture

Single Lambda proxy — the extension never touches Bedrock or S3 directly.

```
background.js  →  SigV4 POST  →  Lambda Function URL (AuthType: AWS_IAM)
                                        ├── Bedrock (InvokeModel)
                                        └── S3 (cache — Feature 4)
```

**IAM user** (credentials stored in `chrome.storage.sync` via options page): only permission is `lambda:InvokeFunctionUrl` on the one Lambda ARN.

**Options page fields:** AWS access key ID, secret access key, region, Lambda Function URL.

**File structure:**
```
manifest.json
content.js       ← DOM manipulation, UI
background.js    ← SigV4 signing, Lambda calls
options.html/js  ← credential settings
styles.css
```

---

## Feature 4: Caching (implement last)

Lookup order: `chrome.storage.local` → S3 → Bedrock. Write back to both on a Bedrock hit.

S3 keys: `translations/{sha256}.json`, `harakat/{sha256}.json`. Add S3 bucket name to options page.
