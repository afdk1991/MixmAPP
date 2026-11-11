import type { Config } from '../config.js';
import { AppError } from '../lib/errors.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type AiProvider = {
  readonly name: string;
  readonly model: string;
  chat(input: { messages: ChatMessage[]; model?: string; temperature?: number }): Promise<{
    content: string;
    usage?: { promptTokens: number; completionTokens: number };
  }>;
};

/** OpenAI 兼容协议：OpenAI / 豆包方舟 / 通义 / DeepSeek / 本地 vLLM 都走这一层。 */
export class OpenAiCompatProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly config: Config['ai'],
  ) {}

  get model(): string {
    return this.config.model;
  }

  async chat(input: { messages: ChatMessage[]; model?: string; temperature?: number }) {
    if (!this.config.apiKey) throw new AppError('PROVIDER_DISABLED', 'AI 服务未配置 API Key');
    const base = this.config.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model ?? this.config.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.7,
        stream: false,
      }),
    });
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string };
    };
    if (!res.ok) throw new AppError('PROVIDER_ERROR', body.error?.message ?? 'AI 调用失败');
    return {
      content: body.choices?.[0]?.message?.content ?? '',
      usage: {
        promptTokens: Number(body.usage?.prompt_tokens ?? 0),
        completionTokens: Number(body.usage?.completion_tokens ?? 0),
      },
    };
  }
}

export class DevAi implements AiProvider {
  readonly name = 'dev';
  readonly model = 'dev-echo';

  async chat(input: { messages: ChatMessage[] }) {
    const last = input.messages.filter((m) => m.role === 'user').pop();
    return {
      content: `开发态 AI 回显：${last?.content ?? ''}\n\n（配置 AI_PROVIDER/AI_API_KEY 后自动切换真实模型）`,
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }
}

export function createAiProvider(config: Config): AiProvider {
  if (config.ai.provider === 'dev' || !config.ai.apiKey) return new DevAi();
  return new OpenAiCompatProvider(config.ai.provider, config.ai);
}
