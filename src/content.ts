console.log('[anghami-plus] content script loaded');

function injectFont(): void {
  if (document.getElementById('anghami-plus-font')) return;
  const link = document.createElement('link');
  link.id = 'anghami-plus-font';
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Amiri:ital@0;1&display=swap';
  document.head.appendChild(link);
}

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

  // Prefer deeper (more specific) elements; break ties by most Arabic chars
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

  // Hide all buttons (listen/like CTAs)
  albumSection.querySelectorAll<HTMLElement>('button').forEach((btn) => {
    btn.style.display = 'none';
  });

  // Hide anchor CTAs — keep only artist and album links
  albumSection
    .querySelectorAll<HTMLElement>(
      'a:not([href*="/artist/"]):not([href*="/album/"])'
    )
    .forEach((a) => {
      a.style.display = 'none';
    });

  // Hide spans that look like play/like counts (only digits, commas, K, M, B)
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
  // Walk up the tree; at each level hide all next siblings, stopping at main/body
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
}

const observer = new MutationObserver(tryCleanup);
observer.observe(document.documentElement, { childList: true, subtree: true });

// Also try immediately in case the page is already rendered
tryCleanup();
