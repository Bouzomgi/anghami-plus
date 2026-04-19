import { LAMBDA_URL, API_SECRET } from './config';

type Action = 'translate' | 'harakat';

interface LambdaRequest {
  action: Action;
  lyrics: string;
}

interface LambdaResponse {
  result?: string;
  error?: string;
}

chrome.runtime.onMessage.addListener(
  (
    msg: LambdaRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (r: LambdaResponse) => void
  ) => {
    if (msg.action !== 'translate' && msg.action !== 'harakat') {
      sendResponse({ error: 'Unknown action' });
      return false;
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
      .then((data) => sendResponse(data))
      .catch((err: Error) => sendResponse({ error: err.message }));

    return true; // keep message channel open for async response
  }
);
