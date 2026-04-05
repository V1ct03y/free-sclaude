# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## AI Proxy Gateway

The API server also serves a dual-compatible OpenAI + Anthropic reverse proxy at `/v1/`.

### Authentication
All `/v1/*` endpoints require `Authorization: Bearer <PROXY_API_KEY>` header.

### Endpoints
- `GET /v1/models` — list all available models (OpenAI + Anthropic)
- `POST /v1/chat/completions` — OpenAI-compatible chat completions (routes to OpenAI or Anthropic by model prefix)
- `POST /v1/messages` — Anthropic Messages native format (routes to Anthropic or OpenAI by model prefix)

### Model routing
- `gpt-*`, `o*` prefixes → OpenAI
- `claude-*` prefix → Anthropic

### Features
- Full streaming support (SSE) with keepalive
- Full tool call / function call support with bidirectional format conversion
- Non-streaming Anthropic uses `stream().finalMessage()` to avoid 10-min timeout

### Environment Variables
- `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` — auto-configured by Replit AI Integrations
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` / `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — auto-configured by Replit AI Integrations
- `PROXY_API_KEY` — user-provided Bearer token secret

## Artifacts

- `artifacts/api-server` — Express API server (routes at `/api` and `/v1`)
- `artifacts/api-portal` — React + Vite portal frontend (at `/`)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
