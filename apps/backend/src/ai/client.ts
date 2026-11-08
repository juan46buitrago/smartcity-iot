/**
 * Cliente mínimo para APIs compatibles con OpenAI (/v1/chat/completions) usando fetch nativo.
 *
 * Diseño de bajo consumo (ver docs/IA.md):
 * - Sin historial: cada llamada es [system, user].
 * - temperature 0 y sin razonamiento (`enable_thinking: false`).
 * - Salida cerrada con `response_format: json_schema` (decodificación restringida, CDM).
 */

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

export interface LlmResult {
  content: string;
  usage: LlmUsage;
  ms: number;
  model: string;
}

export interface CompleteOptions {
  /** JSON Schema de la salida (modo estricto). Si se omite, la salida es texto libre. */
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /** Si el proveedor rechaza json_schema, se reintenta con json_object. */
  jsonFallback?: boolean;
}

export interface LlmClient {
  readonly model: string;
  complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<LlmResult>;
}

export class LlmError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export class OpenAiCompatClient implements LlmClient {
  constructor(
    private readonly cfg: { baseUrl: string; apiKey: string; model: string; timeoutMs: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get model() {
    return this.cfg.model;
  }

  async complete(messages: ChatMessage[], opts: CompleteOptions = {}): Promise<LlmResult> {
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: 0,
      max_tokens: opts.maxTokens ?? 120,
      enable_thinking: false,
    };
    if (opts.schema) {
      body.response_format = { type: 'json_schema', json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema } };
    }
    try {
      return await this.post(body);
    } catch (err) {
      // Plan B: proveedor sin soporte de json_schema → modo JSON (la validación zod sigue aplicando).
      if (opts.schema && opts.jsonFallback !== false && err instanceof LlmError && err.status === 400) {
        return this.post({ ...body, response_format: { type: 'json_object' } });
      }
      throw err;
    }
  }

  private async post(body: Record<string, unknown>): Promise<LlmResult> {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new LlmError(`Proveedor de IA no disponible: ${(err as Error).name}`);
    }
    if (!res.ok) throw new LlmError(`Proveedor de IA respondió ${res.status}`, res.status);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: Partial<LlmUsage>;
      model?: string;
    };
    return {
      content: json.choices?.[0]?.message?.content ?? '',
      usage: { prompt_tokens: json.usage?.prompt_tokens ?? 0, completion_tokens: json.usage?.completion_tokens ?? 0 },
      ms: Date.now() - t0,
      model: json.model ?? this.cfg.model,
    };
  }
}
