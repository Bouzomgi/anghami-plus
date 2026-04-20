import { createHash } from 'crypto';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

const bedrockClient = new BedrockRuntimeClient({});
const s3Client = new S3Client({});
const ssmClient = new SSMClient({});
const MODEL_ID = 'us.anthropic.claude-3-7-sonnet-20250219-v1:0';

let cachedSecret: string | undefined;

async function getApiSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const res = await ssmClient.send(
    new GetParameterCommand({
      Name: process.env.SSM_SECRET_PATH,
      WithDecryption: true,
    })
  );
  cachedSecret = res.Parameter!.Value!;
  return cachedSecret;
}

const PROMPTS = {
  translate: (lyrics: string) =>
    `Translate these Arabic song lyrics to English. Return only the translation, preserving line breaks.\n\n${lyrics}`,

  harakat: (lyrics: string) =>
    `Add harakat (diacritical marks) to these Arabic song lyrics.\n` +
    `These are song lyrics written in colloquial Arabic dialect (ammiyya), not Modern Standard Arabic (fusha). ` +
    `Apply harakat according to how the words are actually pronounced in dialect, not their fusha equivalents.\n` +
    `Rules:\n` +
    `- INCLUDE: kasra (\\u0650), damma (\\u064F), shadda (\\u0651), sukun (\\u0652), tanwin kasra (\\u064D), tanwin damma (\\u064C), tanwin fatha (\\u064B)\n` +
    `- DO NOT ADD: fatha (\\u064E) — omit entirely\n` +
    `Return only the harakated text, preserving line breaks.\n\n${lyrics}`,

  breakdown: (lyrics: string) =>
    `You are helping a student learn colloquial Arabic through song lyrics.\n` +
    `These are dialect (ammiyya) lyrics, not Modern Standard Arabic.\n\n` +
    `For each non-empty line, provide:\n` +
    `1. A LITERAL English translation — word-for-word as much as possible, so the learner can map each Arabic word to its English equivalent. Preserve the Arabic word order where readable.\n` +
    `2. 2-4 key words or short phrases from that line with their individual meanings. Focus on vocab, verb forms, or idioms worth knowing.\n\n` +
    `Return a JSON array with no markdown or code fences. Each element:\n` +
    `{"arabic":"original line","translation":"literal English translation","phrases":[{"arabic":"word or phrase","english":"meaning"}]}\n\n` +
    `Lyrics:\n${lyrics}`,
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

async function getFromS3(bucket: string, key: string): Promise<string | null> {
  try {
    const res = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    return (await res.Body?.transformToString()) ?? null;
  } catch {
    return null;
  }
}

async function putToS3(
  bucket: string,
  key: string,
  value: string
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: value,
      ContentType: 'text/plain',
    })
  );
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const apiSecret = await getApiSecret();

  if (event.headers['x-api-secret'] !== apiSecret) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  let parsed: { action?: string; lyrics?: string };
  try {
    parsed = JSON.parse(event.body ?? '{}') as typeof parsed;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const { action, lyrics } = parsed;

  if (!lyrics || (action !== 'translate' && action !== 'harakat' && action !== 'breakdown')) {
    return jsonResponse(400, {
      error: 'action must be "translate" or "harakat", lyrics required',
    });
  }

  const bucket = process.env.CACHE_BUCKET;
  const hash = createHash('sha256').update(lyrics).digest('hex');
  const s3Key = `${action}s/${hash}.txt`;

  if (bucket) {
    const cached = await getFromS3(bucket, s3Key);
    if (cached) return jsonResponse(200, { result: cached });
  }

  const prompt = PROMPTS[action](lyrics);

  try {
    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const response = await bedrockClient.send(command);
    const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
      content: { text: string }[];
    };

    const raw = payload.content[0].text;
    const result =
      action === 'harakat'
        ? raw
            .replace(/\\/g, '') // strip model-artifact backslashes
            .replace(/\u064E/g, '') // strip fatha
            .replace( // strip non-tanwin harakat from word-final letters
              /([\u0600-\u06FF])([\u064B-\u0652]*)(?=[^\u0600-\u06FF\u064B-\u0652]|$)/gm,
              (_, letter: string, harakat: string) =>
                letter + harakat.replace(/[\u064F\u0650\u0651\u0652]/g, '')
            )
        : raw;

    if (bucket) await putToS3(bucket, s3Key, result);

    return jsonResponse(200, { result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: message });
  }
};
