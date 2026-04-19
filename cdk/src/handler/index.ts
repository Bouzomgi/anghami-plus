import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const client = new BedrockRuntimeClient({});
const MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

const PROMPTS = {
  translate: (lyrics: string) =>
    `Translate these Arabic song lyrics to English. Return only the translation, preserving line breaks.\n\n${lyrics}`,

  harakat: (lyrics: string) =>
    `Add harakat (diacritical marks) to these Arabic song lyrics.\n` +
    `Rules:\n` +
    `- INCLUDE: kasra (\\u0650), damma (\\u064F), shadda (\\u0651), sukun (\\u0652), tanwin kasra (\\u064D), tanwin damma (\\u064C)\n` +
    `- DO NOT ADD: fatha (\\u064E) or tanwin fatha (\\u064B) — omit these entirely\n` +
    `Return only the harakated text, preserving line breaks.\n\n${lyrics}`,
};

function jsonResponse(
  statusCode: number,
  body: Record<string, string>
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (event.headers['x-api-secret'] !== process.env.API_SECRET) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  let parsed: { action?: string; lyrics?: string };
  try {
    parsed = JSON.parse(event.body ?? '{}') as typeof parsed;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { action, lyrics } = parsed;

  if (!lyrics || (action !== 'translate' && action !== 'harakat')) {
    return jsonResponse(400, { error: 'action must be "translate" or "harakat", lyrics required' });
  }

  const prompt = PROMPTS[action](lyrics);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const response = await client.send(command);
    const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
      content: { text: string }[];
    };

    return jsonResponse(200, { result: payload.content[0].text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: message });
  }
};
