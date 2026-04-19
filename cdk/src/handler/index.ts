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
const MODEL_ID = 'us.amazon.nova-pro-v1:0';

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

  if (!lyrics || (action !== 'translate' && action !== 'harakat')) {
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
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { max_new_tokens: 4096 },
      }),
    });

    const response = await bedrockClient.send(command);
    const payload = JSON.parse(new TextDecoder().decode(response.body)) as {
      output: { message: { content: { text: string }[] } };
    };

    const result = payload.output.message.content[0].text;

    if (bucket) await putToS3(bucket, s3Key, result);

    return jsonResponse(200, { result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: message });
  }
};
