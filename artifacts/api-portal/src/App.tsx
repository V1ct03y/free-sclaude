import { useState, useEffect, useCallback } from "react";

const DARK_BG = "hsl(222, 47%, 11%)";
const CARD_BG = "hsl(222, 47%, 15%)";
const BORDER = "hsl(222, 47%, 22%)";
const TEXT = "hsl(210, 40%, 96%)";
const MUTED = "hsl(215, 16%, 57%)";
const OPENAI_BLUE = "#3B82F6";
const ANTHROPIC_ORANGE = "#F97316";
const SUCCESS_GREEN = "#22C55E";

const models = [
  { id: "gpt-5.2", provider: "OpenAI" },
  { id: "gpt-5-mini", provider: "OpenAI" },
  { id: "gpt-5-nano", provider: "OpenAI" },
  { id: "o4-mini", provider: "OpenAI" },
  { id: "o3", provider: "OpenAI" },
  { id: "claude-opus-4-6", provider: "Anthropic" },
  { id: "claude-sonnet-4-6", provider: "Anthropic" },
  { id: "claude-haiku-4-5", provider: "Anthropic" },
];

const endpoints = [
  {
    method: "GET",
    path: "/v1/models",
    type: "Both",
    description: "List all available models from OpenAI and Anthropic",
  },
  {
    method: "POST",
    path: "/v1/chat/completions",
    type: "OpenAI",
    description: "OpenAI-compatible chat completions. Supports streaming, tool calls, and both OpenAI and Anthropic models.",
  },
  {
    method: "POST",
    path: "/v1/messages",
    type: "Anthropic",
    description: "Anthropic Messages API native format. Supports streaming, tool calls, and both Claude and OpenAI models.",
  },
];

const steps = [
  {
    n: 1,
    title: "Add Provider",
    desc: 'In CherryStudio, go to Settings → Model Providers → click "+" to add a new provider.',
  },
  {
    n: 2,
    title: "Choose Format",
    desc: 'Select "OpenAI" as the provider type for /v1/chat/completions, or "Anthropic" for /v1/messages native format.',
  },
  {
    n: 3,
    title: "Enter Base URL & Key",
    desc: "Set the API Base URL to your deployment domain (e.g. https://your-app.replit.app) and paste your PROXY_API_KEY as the API Key.",
  },
  {
    n: 4,
    title: "Start Chatting",
    desc: "Pick any model from the list above. All requests are proxied via Replit AI Integrations — no personal API keys needed.",
  },
];

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve) => {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
    resolve();
  });
}

function CopyButton({ text, style }: { text: string; style?: React.CSSProperties }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.08)",
        border: `1px solid ${copied ? "rgba(34,197,94,0.4)" : BORDER}`,
        borderRadius: 6,
        color: copied ? SUCCESS_GREEN : MUTED,
        cursor: "pointer",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.03em",
        padding: "3px 10px",
        transition: "all 0.2s",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function MethodBadge({ method }: { method: string }) {
  const bg = method === "GET" ? "rgba(34,197,94,0.15)" : "rgba(168,85,247,0.15)";
  const color = method === "GET" ? SUCCESS_GREEN : "#A855F7";
  const border = method === "GET" ? "rgba(34,197,94,0.3)" : "rgba(168,85,247,0.3)";
  return (
    <span
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 4,
        color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        padding: "2px 7px",
      }}
    >
      {method}
    </span>
  );
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, { bg: string; color: string; border: string }> = {
    OpenAI: { bg: "rgba(59,130,246,0.12)", color: OPENAI_BLUE, border: "rgba(59,130,246,0.3)" },
    Anthropic: { bg: "rgba(249,115,22,0.12)", color: ANTHROPIC_ORANGE, border: "rgba(249,115,22,0.3)" },
    Both: { bg: "rgba(100,116,139,0.15)", color: "#94A3B8", border: "rgba(100,116,139,0.3)" },
  };
  const s = map[type] ?? map["Both"];
  return (
    <span
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 4,
        color: s.color,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.05em",
        padding: "2px 7px",
      }}
    >
      {type}
    </span>
  );
}

function ProviderBadge({ provider }: { provider: string }) {
  const isOpenAI = provider === "OpenAI";
  return (
    <span
      style={{
        background: isOpenAI ? "rgba(59,130,246,0.12)" : "rgba(249,115,22,0.12)",
        border: `1px solid ${isOpenAI ? "rgba(59,130,246,0.3)" : "rgba(249,115,22,0.3)"}`,
        borderRadius: 4,
        color: isOpenAI ? OPENAI_BLUE : ANTHROPIC_ORANGE,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 7px",
      }}
    >
      {provider}
    </span>
  );
}

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const baseUrl = window.location.origin;

  useEffect(() => {
    fetch("/api/healthz")
      .then((r) => setOnline(r.ok))
      .catch(() => setOnline(false));
  }, []);

  const curlExample = `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.2",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "stream": false
  }'`;

  return (
    <div
      style={{
        background: DARK_BG,
        color: TEXT,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        minHeight: "100vh",
        padding: 0,
        margin: 0,
      }}
    >
      {/* Header */}
      <header
        style={{
          background: CARD_BG,
          borderBottom: `1px solid ${BORDER}`,
          padding: "18px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              background: "linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #F97316 100%)",
              borderRadius: 10,
              width: 38,
              height: 38,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            ⚡
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
              AI Proxy Gateway
            </div>
            <div style={{ fontSize: 12, color: MUTED }}>OpenAI + Anthropic dual-compatible API</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background:
                online === null ? "#94A3B8" : online ? SUCCESS_GREEN : "#EF4444",
              boxShadow:
                online === true ? `0 0 0 4px rgba(34,197,94,0.2)` : online === false ? `0 0 0 4px rgba(239,68,68,0.2)` : "none",
              transition: "all 0.3s",
            }}
          />
          <span style={{ fontSize: 12, color: MUTED }}>
            {online === null ? "Checking..." : online ? "Online" : "Offline"}
          </span>
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px" }}>
        {/* Connection Details */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16, marginTop: 0 }}>
            Connection Details
          </h2>
          <div
            style={{
              background: CARD_BG,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {[
              { label: "Base URL", value: baseUrl },
              { label: "Authorization Header", value: "Bearer YOUR_PROXY_API_KEY" },
            ].map((row, i) => (
              <div
                key={row.label}
                style={{
                  borderBottom: i < 1 ? `1px solid ${BORDER}` : undefined,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 20px",
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: MUTED, marginBottom: 3 }}>{row.label}</div>
                  <code style={{ fontSize: 13, fontFamily: "Menlo, monospace", color: TEXT }}>
                    {row.value}
                  </code>
                </div>
                <CopyButton text={row.value} />
              </div>
            ))}
          </div>
        </section>

        {/* API Endpoints */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16, marginTop: 0 }}>
            API Endpoints
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {endpoints.map((ep) => (
              <div
                key={ep.path}
                style={{
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: "14px 20px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <MethodBadge method={ep.method} />
                  <code style={{ fontSize: 13, fontFamily: "Menlo, monospace", color: TEXT, flex: 1 }}>
                    {baseUrl}{ep.path}
                  </code>
                  <TypeBadge type={ep.type} />
                  <CopyButton text={`${baseUrl}${ep.path}`} />
                </div>
                <p style={{ margin: 0, fontSize: 13, color: MUTED, lineHeight: 1.5 }}>{ep.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Available Models */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16, marginTop: 0 }}>
            Available Models
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 10,
            }}
          >
            {models.map((m) => (
              <div
                key={m.id}
                style={{
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <code style={{ fontSize: 12, fontFamily: "Menlo, monospace", color: TEXT, wordBreak: "break-all" }}>
                  {m.id}
                </code>
                <ProviderBadge provider={m.provider} />
              </div>
            ))}
          </div>
        </section>

        {/* CherryStudio Setup */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16, marginTop: 0 }}>
            CherryStudio Setup Guide
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {steps.map((step) => (
              <div
                key={step.n}
                style={{
                  background: CARD_BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: "16px 20px",
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    background: "linear-gradient(135deg, #3B82F6, #8B5CF6)",
                    borderRadius: "50%",
                    color: "#fff",
                    flexShrink: 0,
                    fontSize: 13,
                    fontWeight: 700,
                    height: 32,
                    lineHeight: "32px",
                    textAlign: "center",
                    width: 32,
                  }}
                >
                  {step.n}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick Test */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16, marginTop: 0 }}>
            Quick Test (curl)
          </h2>
          <div
            style={{
              background: "hsl(222, 47%, 9%)",
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: CARD_BG,
                borderBottom: `1px solid ${BORDER}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 16px",
              }}
            >
              <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>bash</span>
              <CopyButton text={curlExample} />
            </div>
            <pre
              style={{
                fontFamily: "Menlo, 'Courier New', monospace",
                fontSize: 12,
                lineHeight: 1.7,
                margin: 0,
                overflowX: "auto",
                padding: "20px 20px",
                color: TEXT,
              }}
            >
              {curlExample
                .split("\n")
                .map((line, i) => {
                  if (line.startsWith("curl ")) {
                    return (
                      <span key={i}>
                        <span style={{ color: "#60A5FA" }}>curl</span>
                        <span style={{ color: "#F8FAFC" }}>{line.slice(4)}</span>
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.trimStart().startsWith("-H ")) {
                    const flag = line.slice(0, line.indexOf("-H") + 2);
                    const rest = line.slice(line.indexOf("-H") + 2);
                    return (
                      <span key={i}>
                        <span style={{ color: "#94A3B8" }}>{flag}</span>
                        <span style={{ color: "#F97316" }}>{rest}</span>
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.trimStart().startsWith("-d ")) {
                    return (
                      <span key={i}>
                        <span style={{ color: "#94A3B8" }}>{line.slice(0, line.indexOf("-d") + 2)}</span>
                        <span style={{ color: "#A3E635" }}>{line.slice(line.indexOf("-d") + 2)}</span>
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.trim().startsWith('"') || line.trim().startsWith("}") || line.trim().startsWith("{") || line.trim().startsWith("]") || line.trim().startsWith("[")) {
                    return (
                      <span key={i} style={{ color: "#94A3B8" }}>
                        {line}
                        {"\n"}
                      </span>
                    );
                  }
                  return (
                    <span key={i} style={{ color: "#E2E8F0" }}>
                      {line}
                      {"\n"}
                    </span>
                  );
                })}
            </pre>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: `1px solid ${BORDER}`,
          color: MUTED,
          fontSize: 12,
          padding: "18px 32px",
          textAlign: "center",
        }}
      >
        Powered by Replit AI Integrations · OpenAI SDK + Anthropic SDK · Express.js · No personal API keys required — charges billed to your Replit credits
      </footer>
    </div>
  );
}
