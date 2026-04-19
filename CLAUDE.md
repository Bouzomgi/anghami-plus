# Anghami Plus

Chrome extension for `kalimat.anghami.com/lyrics/{id}`. See `INSTRUCTIONS.md` and `ARCHITECTURE.md` for full spec.

## Stack

TypeScript + esbuild → `dist/`. ESLint + Prettier + Jest. Chrome Manifest V3.

## Scripts

```
npm run build          # tsc --noEmit (placeholder until esbuild in #11)
npm run lint           # ESLint
npm run format:check   # Prettier
npm run format:write   # Prettier fix
npm test               # Jest
```

## Key constraints

- DOM selectors must be structural (no hashed CSS-in-JS classes). Use `src` containing `anghcdn.co` for album art, `href` containing `/artist/` or `/album/`.
- Harakat: include kasra/damma/shadda/sukun/tanwin-kasra/tanwin-damma. **Exclude fatha (U+064E) and tanwin-fatha (U+064B).**
- Lambda Function URL uses `AuthType: AWS_IAM` — never expose Bedrock/S3 directly.
- Credentials live in `chrome.storage.sync` (options page).

## CI

GitHub Actions runs on every PR to `main` (`npm ci → lint → format:check → test → build`). Branch protection requires it to pass.
