import { OpenAIClient } from '@anvia/openai';
import 'dotenv/config';

const DEFAULT_MODEL_ID = 'gpt-5.6-luna';

let client: OpenAIClient | undefined;

/**
 * Built lazily so that scripts can repoint OPENAI_BASE_URL (for example at the
 * offline stub model) after this module has been imported.
 */
function getClient(): OpenAIClient {
  if (client === undefined) {
    const baseUrl = process.env['OPENAI_BASE_URL'];
    client = new OpenAIClient({
      apiKey: process.env['OPENAI_API_KEY']!,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }
  return client;
}

export function getModel(modelId?: string) {
  return getClient().completionModel({
    modelId: modelId ?? process.env['OPENAI_MODEL'] ?? DEFAULT_MODEL_ID,
    api: process.env['OPENAI_API'] === 'chat' ? 'chat' : 'responses',
  });
}
