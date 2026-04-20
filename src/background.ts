import { LAMBDA_URL, API_SECRET } from './config';

type Action = 'translate' | 'harakat' | 'breakdown';

interface LambdaRequest {
  action: Action;
  lyrics: string;
}

interface LambdaResponse {
  result?: string;
  error?: string;
}

function cacheKey(action: Action, lyrics: string): string {
  return `${action}:${lyrics}`;
}

chrome.runtime.onMessage.addListener(
  (
    msg: LambdaRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: LambdaResponse) => void
  ) => {
    if (
      msg.action !== 'translate' &&
      msg.action !== 'harakat' &&
      msg.action !== 'breakdown'
    ) {
      sendResponse({ error: 'Unknown action' });
      return false;
    }

    const key = cacheKey(msg.action, msg.lyrics);

    chrome.storage.local.get(key, (stored) => {
      if (stored[key]) {
        sendResponse({ result: stored[key] as string });
        return;
      }

      fetch(LAMBDA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Secret': API_SECRET,
        },
        body: JSON.stringify({ action: msg.action, lyrics: msg.lyrics }),
      })
        .then((res) => res.json() as Promise<LambdaResponse>)
        .then((data) => {
          if (data.result) {
            chrome.storage.local.set({ [key]: data.result });
          }
          sendResponse(data);
        })
        .catch((err: Error) => {
          console.error('[anghami-plus] fetch error', err);
          sendResponse({ error: err.message });
        });
    });

    return true;
  }
);
