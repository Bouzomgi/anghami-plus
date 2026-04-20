console.log('[anghami-plus] content script loaded');

// ── Font ──────────────────────────────────────────────────────────────────────

function injectFont(): void {
  if (document.getElementById('anghami-plus-font')) return;
  const style = document.createElement('style');
  style.id = 'anghami-plus-font';
  style.textContent = `
    [data-ap-lyrics],
    [data-ap-lyrics] * {
      font-family: 'Geeza Pro', serif !important;
    }
    [data-ap-lyrics] {
      font-size: 1.3rem !important;
      line-height: 2.2 !important;
      direction: rtl !important;
    }
  `;
  document.head.appendChild(style);
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
  el.setAttribute('data-ap-lyrics', '');
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

async function callLambda(
  action: Action,
  lyrics: string
): Promise<{ result?: string; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, lyrics }, resolve);
  });
}

// ── Harakat toggle ────────────────────────────────────────────────────────────

function renderHarakatToggle(lyricsEl: HTMLElement): void {
  const toolbar = document.createElement('div');
  toolbar.id = 'anghami-plus-toolbar';
  toolbar.style.cssText =
    'display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0;margin-bottom:0.75rem;font-family:system-ui,sans-serif;';

  const btn = document.createElement('button');
  btn.id = 'anghami-plus-harakat-btn';
  btn.textContent = 'Show Harakat';
  btn.style.cssText =
    'padding:0.3rem 0.85rem;background:#6c3fa0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.85rem;white-space:nowrap;';

  toolbar.appendChild(btn);

  // Wrap lyrics text in its own element so the toolbar isn't wiped on harakat toggle
  const lyricsBody = document.createElement('div');
  lyricsBody.id = 'anghami-plus-lyrics-body';
  lyricsBody.innerHTML = lyricsEl.innerHTML;
  lyricsEl.innerHTML = '';
  lyricsEl.appendChild(toolbar);
  lyricsEl.appendChild(lyricsBody);

  const originalHTML = lyricsBody.innerHTML;
  const originalText = lyricsBody.innerText;

  let harakated: string | null = null;
  let showingHarakat = false;

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
      const scrollY = window.scrollY;
      const wrapper = document.createElement('div');
      wrapper.innerHTML = originalHTML;
      const lineEls = Array.from(wrapper.querySelectorAll<HTMLElement>('p'));
      const preEl = wrapper.querySelector<HTMLElement>('pre');
      const harakatLines = harakated.split('\n');
      if (lineEls.length > 0) {
        const nonEmpty = harakatLines.filter((l) => l.trim() !== '');
        lineEls.forEach((el, i) => {
          if (i < nonEmpty.length) el.innerHTML = nonEmpty[i];
        });
        lyricsBody.innerHTML = wrapper.innerHTML;
      } else if (preEl) {
        preEl.textContent = harakated;
        lyricsBody.innerHTML = wrapper.innerHTML;
      } else {
        lyricsBody.innerHTML = harakatLines
          .map((line) => `<p>${line}</p>`)
          .join('');
      }
      window.scrollTo(0, scrollY);
      btn.textContent = 'Hide Harakat';
      showingHarakat = true;
    } else {
      const scrollY = window.scrollY;
      lyricsBody.innerHTML = originalHTML;
      window.scrollTo(0, scrollY);
      btn.textContent = 'Show Harakat';
      showingHarakat = false;
    }
  });
}

// ── Translation ───────────────────────────────────────────────────────────────

function renderTranslation(lyricsEl: HTMLElement): void {
  const originalText = document.getElementById(
    'anghami-plus-lyrics-body'
  )!.innerText;

  const section = document.createElement('div');
  section.id = 'anghami-plus-translation';
  section.style.cssText =
    'margin-top:2rem;padding-top:1.5rem;border-top:1px solid #ddd;font-family:system-ui,sans-serif;direction:ltr;text-align:left;';

  const btn = document.createElement('button');
  btn.id = 'anghami-plus-translate-btn';
  btn.textContent = 'Show Translation';
  btn.style.cssText =
    'padding:0.3rem 0.85rem;background:#6c3fa0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.85rem;white-space:nowrap;';

  const body = document.createElement('div');
  body.id = 'anghami-plus-translation-body';
  body.style.cssText =
    'display:none;margin-top:1rem;font-size:1rem;line-height:1.8;color:#333;white-space:pre-wrap;';

  section.appendChild(btn);
  section.appendChild(body);
  lyricsEl.appendChild(section);

  let translated: string | null = null;
  let showing = false;

  btn.addEventListener('click', async () => {
    if (!showing) {
      if (!translated) {
        btn.textContent = 'Loading…';
        btn.disabled = true;
        const res = await callLambda('translate', originalText);
        btn.disabled = false;
        if (res.error || !res.result) {
          btn.textContent = `Error: ${res.error ?? 'unknown'}`;
          return;
        }
        translated = res.result;
      }
      body.textContent = translated;
      body.style.display = 'block';
      btn.textContent = 'Hide Translation';
      showing = true;
    } else {
      body.style.display = 'none';
      btn.textContent = 'Show Translation';
      showing = false;
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

let inited = false;

function tryCleanup(): void {
  if (!document.querySelector('img[src*="anghcdn.co"]')) return;
  const lyrics = findLyricsContainer();
  if (!lyrics) return;

  // Always re-apply — React re-renders wipe the attribute
  lyrics.setAttribute('data-ap-lyrics', '');

  if (!inited) {
    inited = true;
    injectFont();
    cleanupPage();
    renderHarakatToggle(lyrics);
    renderTranslation(lyrics);
    const songTitle = document.querySelector('h1')?.textContent?.trim();
    if (songTitle) document.title = songTitle;
  }
}

const observer = new MutationObserver(tryCleanup);
observer.observe(document.documentElement, { childList: true, subtree: true });

tryCleanup();
