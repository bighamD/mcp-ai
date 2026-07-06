# mcp-ai

Learning project for building a first Model Context Protocol (MCP) server and testing it from Codex.

Chinese documentation: [README.zh-CN.md](./README.zh-CN.md)

## Yinghuochong MCP Server

This MCP server is a read-only business data adapter for the local Yinghuochong MySQL database. It exposes order and user queries as structured MCP tools so Codex can inspect business data safely.

Tools:

- `yhc_list_databases`
- `yhc_search_orders`
- `yhc_get_order_detail`
- `yhc_list_users`

## Local Setup

```bash
npm install
npm run build
```

Default database settings:

```text
Host: 127.0.0.1
Port: 3306
User: root
Password: empty
Default DB: yinghuochong_recovery_clean_20260608
```

Copy `.env.example` only if you need to override defaults.

## Run

```bash
npm run start
```

Codex MCP command:

```bash
node /Users/pengdahan/WorkSpace/mcp-ai/dist/index.js
```

## Source Layout

Runtime flow:

```text
Codex -> src/index.ts -> registerYhcTools -> src/db.ts -> MySQL
```

- `src/index.ts`: MCP server entry point. Creates the server, registers tools, and connects through stdio.
- `src/config.ts`: Reads database configuration and enforces the allowed database whitelist.
- `src/db.ts`: Shared MySQL access layer with connection pooling, database validation, identifier quoting, and `queryRows<T>()`.
- `src/format.ts`: Shared response formatting helpers for money, JSON text, and pagination metadata.
- `src/tools/yhc.ts`: Registers all Yinghuochong read-only business query tools.

## Safety Boundaries

- Database names must be in `YHC_ALLOWED_DATABASES`.
- SQL values use parameterized placeholders.
- SQL identifiers are validated before quoting.
- All tools are marked read-only in MCP annotations.
