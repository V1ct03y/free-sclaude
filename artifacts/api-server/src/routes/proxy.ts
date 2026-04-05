import { Router, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
});

const anthropic = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "dummy",
});

const OPENAI_MODELS = [
  { id: "gpt-5.2", provider: "openai" },
  { id: "gpt-5-mini", provider: "openai" },
  { id: "gpt-5-nano", provider: "openai" },
  { id: "o4-mini", provider: "openai" },
  { id: "o3", provider: "openai" },
];

const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", provider: "anthropic" },
  { id: "claude-haiku-4-5", provider: "anthropic" },
];

const ALL_MODELS = [...OPENAI_MODELS, ...ANTHROPIC_MODELS];

function verifyBearer(req: Request, res: Response): boolean {
  const auth = req.headers["authorization"] ?? "";
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const xApiKey = (req.headers["x-api-key"] as string) ?? "";
  const token = bearerToken || xApiKey;
  if (!token || token !== process.env.PROXY_API_KEY) {
    res.status(401).json({ error: { message: "Unauthorized", type: "authentication_error" } });
    return false;
  }
  return true;
}

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o");
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
type AnthropicTool = Anthropic.Tool;
type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type AnthropicMessage = Anthropic.MessageParam;

function openAIToolsToAnthropic(tools: OpenAITool[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
}

function openAIToolChoiceToAnthropic(
  choice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
): Anthropic.ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && choice.function) {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

function openAIMessagesToAnthropic(
  messages: OpenAIMessage[],
): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : "";
      continue;
    }

    if (msg.role === "tool") {
      const last = result[result.length - 1];
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: typeof msg.content === "string" ? msg.content : "",
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const contentBlocks: Anthropic.ContentBlock[] = [];
      if (typeof msg.content === "string" && msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      result.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "";
      result.push({ role: "user", content });
    }
  }

  return { system, messages: result };
}

function anthropicMessageToOpenAI(msg: Anthropic.Message): OpenAI.Chat.Completions.ChatCompletion {
  const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
  let text = "";

  for (const block of msg.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const finishReason: OpenAI.Chat.Completions.ChatCompletion.Choice["finish_reason"] =
    msg.stop_reason === "tool_use" ? "tool_calls" : "stop";

  return {
    id: msg.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: msg.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          refusal: null,
        },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: msg.usage.input_tokens,
      completion_tokens: msg.usage.output_tokens,
      total_tokens: msg.usage.input_tokens + msg.usage.output_tokens,
    },
  };
}

router.get("/models", (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const now = Math.floor(Date.now() / 1000);
  res.json({
    object: "list",
    data: ALL_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: now,
      owned_by: m.provider,
    })),
  });
});

router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as {
    model: string;
    messages: OpenAIMessage[];
    stream?: boolean;
    tools?: OpenAITool[];
    tool_choice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption;
    max_tokens?: number;
    temperature?: number;
    [key: string]: unknown;
  };

  const { model, messages, stream, tools, tool_choice, max_tokens: _mt, temperature, top_p, top_k, metadata, stop_sequences, thinking, ...restBody } = body;

  if (!model) {
    res.status(400).json({ error: { message: "model is required", type: "invalid_request_error" } });
    return;
  }

  try {
    if (isOpenAIModel(model)) {
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);

        req.on("close", () => clearInterval(keepalive));

        try {
          const streamReq = await openai.chat.completions.create({
            ...body,
            stream: true,
          } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

          for await (const chunk of streamReq) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            (res as unknown as { flush?: () => void }).flush?.();
          }

          res.write("data: [DONE]\n\n");
          res.end();
        } finally {
          clearInterval(keepalive);
        }
      } else {
        const completion = await openai.chat.completions.create({
          ...body,
          stream: false,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
        res.json(completion);
      }
    } else if (isAnthropicModel(model)) {
      const { system, messages: anthropicMessages } = openAIMessagesToAnthropic(messages);
      const anthropicTools = tools ? openAIToolsToAnthropic(tools) : undefined;
      const anthropicToolChoice = openAIToolChoiceToAnthropic(tool_choice);
      const maxTokens = body.max_tokens ?? 8192;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);

        req.on("close", () => clearInterval(keepalive));

        try {
          const streamParams: Anthropic.Messages.MessageStreamParams = {
            model,
            max_tokens: maxTokens,
            messages: anthropicMessages,
            ...(system ? { system } : {}),
            ...(anthropicTools ? { tools: anthropicTools } : {}),
            ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
            ...(top_p !== undefined ? { top_p: top_p as number } : {}),
            ...(top_k !== undefined ? { top_k: top_k as number } : {}),
            ...(metadata !== undefined ? { metadata: metadata as Anthropic.Messages.MessageStreamParams["metadata"] } : {}),
            ...(stop_sequences !== undefined ? { stop_sequences: stop_sequences as string[] } : {}),
            ...(thinking !== undefined ? { thinking: thinking as Anthropic.Messages.MessageStreamParams["thinking"] } : {}),
          };

          const anthropicStream = anthropic.messages.stream(streamParams);

          const chatId = `chatcmpl-${Date.now()}`;
          let toolUseId = "";
          let toolUseName = "";

          for await (const event of anthropicStream) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "tool_use") {
                toolUseId = event.content_block.id;
                toolUseName = event.content_block.name;
                const chunk = {
                  id: chatId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: toolUseId,
                            type: "function",
                            function: { name: toolUseName, arguments: "" },
                          },
                        ],
                      },
                      finish_reason: null,
                    },
                  ],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              } else if (event.content_block.type === "text") {
                const chunk = {
                  id: chatId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                const chunk = {
                  id: chatId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              } else if (event.delta.type === "input_json_delta") {
                const chunk = {
                  id: chatId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [{ index: 0, function: { arguments: event.delta.partial_json } }],
                      },
                      finish_reason: null,
                    },
                  ],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            } else if (event.type === "message_delta") {
              const finishReason = event.delta.stop_reason === "tool_use" ? "tool_calls" : "stop";
              const chunk = {
                id: chatId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            (res as unknown as { flush?: () => void }).flush?.();
          }

          res.write("data: [DONE]\n\n");
          res.end();
        } finally {
          clearInterval(keepalive);
        }
      } else {
        const streamParams: Anthropic.Messages.MessageStreamParams = {
          model,
          max_tokens: maxTokens,
          messages: anthropicMessages,
          ...(system ? { system } : {}),
          ...(anthropicTools ? { tools: anthropicTools } : {}),
          ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(top_p !== undefined ? { top_p: top_p as number } : {}),
          ...(top_k !== undefined ? { top_k: top_k as number } : {}),
          ...(metadata !== undefined ? { metadata: metadata as Anthropic.Messages.MessageStreamParams["metadata"] } : {}),
          ...(stop_sequences !== undefined ? { stop_sequences: stop_sequences as string[] } : {}),
          ...(thinking !== undefined ? { thinking: thinking as Anthropic.Messages.MessageStreamParams["thinking"] } : {}),
        };

        const finalMessage = await anthropic.messages.stream(streamParams).finalMessage();
        const oaiResponse = anthropicMessageToOpenAI(finalMessage);
        res.json(oaiResponse);
      }
    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    logger.error({ err }, "Proxy error in /v1/chat/completions");
    if (!res.headersSent) {
      res.status(500).json({ error: { message: "Internal server error", type: "server_error" } });
    }
  }
});

type AnthropicNativeMessage = {
  model: string;
  messages: AnthropicMessage[];
  system?: string;
  tools?: AnthropicTool[];
  tool_choice?: Anthropic.ToolChoice;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
};

router.post("/messages", async (req: Request, res: Response) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as AnthropicNativeMessage;
  const { model, messages: anthropicMessages, system, tools, tool_choice, stream, max_tokens, ...extraParams } = body;
  const maxTokens = max_tokens ?? 8192;

  if (!model) {
    res.status(400).json({ error: { message: "model is required", type: "invalid_request_error" } });
    return;
  }

  try {
    if (isAnthropicModel(model)) {
      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);

        req.on("close", () => clearInterval(keepalive));

        try {
          const streamParams: Anthropic.Messages.MessageStreamParams = {
            model,
            max_tokens: maxTokens,
            messages: anthropicMessages,
            ...(system ? { system } : {}),
            ...(tools ? { tools } : {}),
            ...(tool_choice ? { tool_choice } : {}),
            ...(extraParams as Partial<Anthropic.Messages.MessageStreamParams>),
          };

          const anthropicStream = anthropic.messages.stream(streamParams);

          for await (const event of anthropicStream) {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            (res as unknown as { flush?: () => void }).flush?.();
          }

          res.end();
        } finally {
          clearInterval(keepalive);
        }
      } else {
        const streamParams: Anthropic.Messages.MessageStreamParams = {
          model,
          max_tokens: maxTokens,
          messages: anthropicMessages,
          ...(system ? { system } : {}),
          ...(tools ? { tools } : {}),
          ...(tool_choice ? { tool_choice } : {}),
          ...(extraParams as Partial<Anthropic.Messages.MessageStreamParams>),
        };
        const finalMessage = await anthropic.messages.stream(streamParams).finalMessage();
        res.json(finalMessage);
      }
    } else if (isOpenAIModel(model)) {
      const openAIMessages: OpenAIMessage[] = [];
      if (system) {
        openAIMessages.push({ role: "system", content: system });
      }
      for (const msg of anthropicMessages) {
        if (msg.role === "user") {
          if (typeof msg.content === "string") {
            openAIMessages.push({ role: "user", content: msg.content });
          } else if (Array.isArray(msg.content)) {
            const parts = msg.content as Anthropic.ContentBlock[];
            const toolResults = parts.filter((p) => p.type === "tool_result");
            const textParts = parts.filter((p) => p.type === "text");

            for (const tr of toolResults as Anthropic.ToolResultBlockParam[]) {
              openAIMessages.push({
                role: "tool",
                tool_call_id: tr.tool_use_id,
                content: typeof tr.content === "string" ? tr.content : "",
              });
            }
            if (textParts.length > 0) {
              openAIMessages.push({
                role: "user",
                content: (textParts as Anthropic.TextBlock[]).map((t) => t.text).join("\n"),
              });
            }
          }
        } else if (msg.role === "assistant") {
          if (typeof msg.content === "string") {
            openAIMessages.push({ role: "assistant", content: msg.content });
          } else if (Array.isArray(msg.content)) {
            const parts = msg.content as Anthropic.ContentBlock[];
            const toolUses = parts.filter((p) => p.type === "tool_use") as Anthropic.ToolUseBlock[];
            const textParts = parts.filter((p) => p.type === "text") as Anthropic.TextBlock[];
            const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = toolUses.map((tu) => ({
              id: tu.id,
              type: "function",
              function: { name: tu.name, arguments: JSON.stringify(tu.input) },
            }));
            openAIMessages.push({
              role: "assistant",
              content: textParts.map((t) => t.text).join("\n") || null,
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            });
          }
        }
      }

      const openAITools: OpenAITool[] | undefined = tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        },
      }));

      let openAIToolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined;
      if (tool_choice) {
        if (tool_choice.type === "auto") openAIToolChoice = "auto";
        else if (tool_choice.type === "any") openAIToolChoice = "required";
        else if (tool_choice.type === "tool") openAIToolChoice = { type: "function", function: { name: (tool_choice as Anthropic.ToolChoiceTool).name } };
      }

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);
        req.on("close", () => clearInterval(keepalive));

        try {
          const oaiStream = await openai.chat.completions.create({
            model,
            messages: openAIMessages,
            stream: true,
            ...(openAITools ? { tools: openAITools } : {}),
            ...(openAIToolChoice ? { tool_choice: openAIToolChoice } : {}),
            max_completion_tokens: maxTokens,
          });

          const msgId = `msg_${Date.now()}`;
          let inputTokens = 0;
          let outputTokens = 0;
          let blockIdx = 0;
          let hasToolUse = false;
          let toolUseId = "";
          let toolUseName = "";

          res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
          res.write(`event: ping\ndata: ${JSON.stringify({ type: "ping" })}\n\n`);

          for await (const chunk of oaiStream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: blockIdx, content_block: { type: "text", text: "" } })}\n\n`);
              res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: blockIdx, delta: { type: "text_delta", text: delta.content } })}\n\n`);
              res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIdx })}\n\n`);
              blockIdx++;
              outputTokens++;
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  toolUseId = tc.id;
                  toolUseName = tc.function?.name ?? "";
                  hasToolUse = true;
                  res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: blockIdx, content_block: { type: "tool_use", id: toolUseId, name: toolUseName, input: {} } })}\n\n`);
                }
                if (tc.function?.arguments) {
                  res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: blockIdx, delta: { type: "input_json_delta", partial_json: tc.function.arguments } })}\n\n`);
                }
              }
            }

            if (chunk.choices[0]?.finish_reason) {
              if (hasToolUse) {
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: blockIdx })}\n\n`);
              }
              const stopReason = hasToolUse ? "tool_use" : "end_turn";
              res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
              res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
            }

            (res as unknown as { flush?: () => void }).flush?.();
          }

          res.end();
        } finally {
          clearInterval(keepalive);
        }
      } else {
        const oaiCompletion = await openai.chat.completions.create({
          model,
          messages: openAIMessages,
          stream: false,
          ...(openAITools ? { tools: openAITools } : {}),
          ...(openAIToolChoice ? { tool_choice: openAIToolChoice } : {}),
          max_completion_tokens: maxTokens,
        });

        const choice = oaiCompletion.choices[0];
        const content: Anthropic.ContentBlock[] = [];
        if (choice?.message?.content) {
          content.push({ type: "text", text: choice.message.content });
        }
        if (choice?.message?.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
            content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
          }
        }

        const stopReason = choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
        const anthropicResponse: Anthropic.Message = {
          id: oaiCompletion.id,
          type: "message",
          role: "assistant",
          content,
          model,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: {
            input_tokens: oaiCompletion.usage?.prompt_tokens ?? 0,
            output_tokens: oaiCompletion.usage?.completion_tokens ?? 0,
          },
        };
        res.json(anthropicResponse);
      }
    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    logger.error({ err }, "Proxy error in /v1/messages");
    if (!res.headersSent) {
      res.status(500).json({ error: { message: "Internal server error", type: "server_error" } });
    }
  }
});

export default router;
