console.log('[anghami-plus] content script loaded');

// ── Font ──────────────────────────────────────────────────────────────────────

function injectFont(): void {
  if (document.getElementById('anghami-plus-font')) return;
  const link = document.createElement('link');
  link.id = 'anghami-plus-font';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Amiri:ital@0;1&display=swap';
  document.head.appendChild(link);
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

const arabicCountCache = new WeakMap<Element, number>();

function arabicCharCount(el: Element): number {
  if (arabicCountCache.has(el)) return arabicCountCache.get(el)!;
  const count = (el.textContent?.match(/[\u0600-\u06FF]/g) ?? []).length;
  arabicCountCache.set(el, count);
  return count;
}

function getDepth(el: Element): number {
  let depth = 0;
  let cur: Element | null = el;
  while (cur) {
    depth++;
    cur = cur.parentElement;
  }
  return depth;
}

function findLyricsContainer(): HTMLElement | null {
  const MIN_ARABIC_CHARS = 80;

  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('div, p, section, article')
  ).filter((el) => {
    if (el.closest('header, footer, nav')) return false;
    if (['BODY', 'MAIN', 'HTML'].includes(el.tagName)) return false;
    return arabicCharCount(el) >= MIN_ARABIC_CHARS;
  });

  candidates.sort((a, b) => {
    const dd = getDepth(b) - getDepth(a);
    if (dd !== 0) return dd;
    return arabicCharCount(b) - arabicCharCount(a);
  });

  return candidates[0] ?? null;
}

function applyFont(el: HTMLElement): void {
  el.style.fontFamily = '"Amiri", serif';
  el.style.fontSize = '1.3rem';
  el.style.lineHeight = '2.2';
  el.style.direction = 'rtl';
}

// ── Page cleanup ──────────────────────────────────────────────────────────────

function unstickAlbumSection(albumArt: HTMLImageElement): void {
  let el: HTMLElement | null = albumArt.parentElement;
  for (
    let i = 0;
    i < 8 && el && el.tagName !== 'MAIN';
    i++, el = el.parentElement
  ) {
    const pos = getComputedStyle(el).position;
    if (pos === 'sticky' || pos === 'fixed') {
      el.style.position = 'static';
    }
  }
}

function hideAlbumCtAs(albumArt: HTMLImageElement): void {
  const albumSection =
    albumArt.closest('section, article') ??
    albumArt.parentElement?.parentElement?.parentElement ??
    null;

  if (!albumSection) return;

  albumSection.querySelectorAll<HTMLElement>('button').forEach((btn) => {
    btn.style.display = 'none';
  });

  albumSection
    .querySelectorAll<HTMLElement>(
      'a:not([href*="/artist/"]):not([href*="/album/"])'
    )
    .forEach((a) => {
      a.style.display = 'none';
    });

  albumSection.querySelectorAll<HTMLElement>('span').forEach((span) => {
    if (/^[\d,.\s]+[KMB]?$/.test(span.textContent?.trim() ?? '')) {
      const parent = span.parentElement;
      if (parent && parent !== albumSection) {
        parent.style.display = 'none';
      } else {
        span.style.display = 'none';
      }
    }
  });
}

function hideAfterLyrics(lyricsEl: HTMLElement): void {
  let el: HTMLElement | null = lyricsEl;
  while (el && el.tagName !== 'MAIN' && el.tagName !== 'BODY') {
    let sibling = el.nextElementSibling;
    while (sibling) {
      (sibling as HTMLElement).style.display = 'none';
      sibling = sibling.nextElementSibling;
    }
    el = el.parentElement;
  }
}

function cleanupPage(): void {
  const albumArt = document.querySelector<HTMLImageElement>(
    'img[src*="anghcdn.co"]'
  );
  if (!albumArt) return;

  unstickAlbumSection(albumArt);
  hideAlbumCtAs(albumArt);

  document.querySelectorAll<HTMLElement>('footer').forEach((el) => {
    el.style.display = 'none';
  });

  const lyrics = findLyricsContainer();
  if (lyrics) {
    applyFont(lyrics);
    hideAfterLyrics(lyrics);
  }
}

// ── Lambda messaging + local cache ────────────────────────────────────────────

type Action = 'translate' | 'harakat';

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function callLambda(
  action: Action,
  lyrics: string
): Promise<{ result?: string; error?: string }> {
  const hash = await sha256hex(lyrics);
  const cacheKey = `ap:${action}:${hash}`;

  const stored = await chrome.storage.local.get(cacheKey);
  if (stored[cacheKey]) return { result: stored[cacheKey] as string };

  const res = await new Promise<{ result?: string; error?: string }>(
    (resolve) => {
      chrome.runtime.sendMessage({ action, lyrics }, resolve);
    }
  );

  if (res.result) await chrome.storage.local.set({ [cacheKey]: res.result });
  return res;
}

// ── Translation section ───────────────────────────────────────────────────────

function renderTranslation(lyricsEl: HTMLElement): void {
  const container = document.createElement('div');
  container.id = 'anghami-plus-translation';
  container.style.cssText =
    'margin-top:2rem;padding:1rem;border-top:1px solid #ccc;font-size:1rem;line-height:1.8;color:#eee;';

  const heading = document.createElement('h3');
  heading.textContent = 'English Translation';
  heading.style.cssText = 'margin:0 0 0.75rem;font-size:1rem;color:#aaa;';

  const body = document.createElement('p');
  body.textContent = 'Loading…';
  body.style.whiteSpace = 'pre-wrap';

  container.appendChild(heading);
  container.appendChild(body);
  lyricsEl.insertAdjacentElement('afterend', container);

  callLambda('translate', lyricsEl.textContent ?? '').then((res) => {
    body.textContent = res.result ?? `Error: ${res.error ?? 'unknown'}`;
  });
}

// ── Harakat toggle ────────────────────────────────────────────────────────────

function renderHarakatToggle(lyricsEl: HTMLElement): void {
  const btn = document.createElement('button');
  btn.id = 'anghami-plus-harakat-btn';
  btn.textContent = 'Show Harakat';
  btn.style.cssText =
    'display:block;margin:1rem 0;padding:0.4rem 1rem;background:#6c3fa0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.9rem;';

  let harakated: string | null = null;
  let showingHarakat = false;
  const originalHTML = lyricsEl.innerHTML;
  const originalText = lyricsEl.textContent ?? '';

  btn.addEventListener('click', async () => {
    if (!showingHarakat) {
      if (!harakated) {
        btn.textContent = 'Loading…';
        btn.disabled = true;
        const res = await callLambda('harakat', originalText);
        btn.disabled = false;
        if (res.error || !res.result) {
          btn.textContent = `Error: ${res.error ?? 'unknown'}`;
          return;
        }
        harakated = res.result;
      }
      lyricsEl.textContent = harakated;
      btn.textContent = 'Hide Harakat';
      showingHarakat = true;
    } else {
      lyricsEl.innerHTML = originalHTML;
      btn.textContent = 'Show Harakat';
      showingHarakat = false;
    }
  });

  lyricsEl.insertAdjacentElement('beforebegin', btn);
}

// ── Init ──────────────────────────────────────────────────────────────────────

let cleaned = false;

function tryCleanup(): void {
  if (cleaned) return;
  if (!document.querySelector('img[src*="anghcdn.co"]')) return;
  const lyrics = findLyricsContainer();
  if (!lyrics) return;
  cleaned = true;
  observer.disconnect();
  injectFont();
  cleanupPage();
  renderHarakatToggle(lyrics);
  renderTranslation(lyrics);
}

const observer = new MutationObserver(tryCleanup);
observer.observe(document.documentElement, { childList: true, subtree: true });

tryCleanup();
