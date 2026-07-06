# mcp-ai

这是一个用于学习如何构建第一个 Model Context Protocol (MCP) 服务，并在 Codex 中测试的练习项目。

MCP 服务可以理解为面向 AI Agent 的标准化工具服务器。它把外部系统里的数据、操作和上下文，通过 MCP 协议暴露给 Codex、Claude Desktop、Cursor 等 AI 应用调用。

在这个项目里，MCP 服务扮演的是萤火虫业务数据查询适配器：它连接本地 MySQL，把订单、用户等查询能力封装成只读 tools，让 Codex 可以安全、结构化地查询业务数据。

English documentation: [README.md](./README.md)

## 萤火虫 MCP 服务

当前第一个 MCP 服务面向本地萤火虫 MySQL 数据库，提供只读业务查询能力。

工具列表：

- `yhc_list_databases`
- `yhc_search_orders`
- `yhc_get_order_detail`
- `yhc_list_users`

## 本地初始化

```bash
npm install
npm run build
```

默认数据库配置：

```text
Host: 127.0.0.1
Port: 3306
User: root
Password: empty
Default DB: yinghuochong_recovery_clean_20260608
```

如果需要覆盖默认配置，可以参考 `.env.example`。

## 运行

```bash
npm run start
```

Codex MCP 配置命令：

```bash
node /Users/pengdahan/WorkSpace/mcp-ai/dist/index.js
```

## 源码结构

运行链路：

```text
Codex -> src/index.ts -> registerYhcTools -> src/db.ts -> MySQL
```

`src/index.ts`

MCP 服务入口。它创建 `yinghuochong-mcp-server`，注册萤火虫相关工具，并通过 `StdioServerTransport` 使用 stdio 方式连接 MCP server。

`src/config.ts`

从环境变量读取数据库配置：

- `YHC_DB_HOST`
- `YHC_DB_PORT`
- `YHC_DB_USER`
- `YHC_DB_PASSWORD`
- `YHC_DEFAULT_DATABASE`
- `YHC_ALLOWED_DATABASES`

它还会校验默认数据库必须包含在允许访问的数据库白名单中。

`src/db.ts`

共享 MySQL 访问层。它负责创建 MySQL 连接池、校验数据库名是否在白名单中、安全地引用 SQL identifier，并通过 `queryRows<T>()` 提供参数化只读查询能力。

`src/format.ts`

工具使用的小型格式化函数：

- `ResponseFormat`：`markdown` 或 `json`
- `moneyFromCents()`：把分转换成展示金额，例如 `¥12.00`
- `jsonText()`：格式化 JSON 文本输出
- `boolMeta()`：分页元数据，包括 `has_more` 和 `next_offset`

`src/tools/yhc.ts`

注册所有萤火虫业务查询工具。这些工具刻意保持只读，并围绕业务问题设计，而不是暴露任意 SQL 执行能力。

- `yhc_list_databases`：列出允许访问的数据库和表行数估算。
- `yhc_search_orders`：按订单号、openid、昵称、手机号、状态和订单角色搜索订单。
- `yhc_get_order_detail`：按 `order_no` 获取单个订单详情，包括订单项、子订单、票券、卡和退款信息。
- `yhc_list_users`：按过滤条件列出用户，并返回轻量级订单 / 资产统计。

## 安全边界

- 数据库名必须包含在 `YHC_ALLOWED_DATABASES` 中。
- SQL 值使用参数化占位符。
- SQL identifier 在引用前会经过校验。
- 所有工具都在 MCP annotations 中标记为只读。

## `server.registerTool` 参数解析

`server.registerTool(...)` 用来把一个函数注册成 MCP tool，让 Codex 或其他 MCP client 可以发现并调用它。

基本结构：

```ts
server.registerTool(
  "tool_name",
  {
    title: "Tool Display Name",
    description: "What this tool does",
    inputSchema: z.object({
      param: z.string(),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async (args) => {
    return {
      content: [
        {
          type: "text",
          text: "result",
        },
      ],
      structuredContent: {
        result: "data",
      },
    };
  },
);
```

第一个参数是 tool name：

```ts
"yhc_list_users"
```

这是 MCP tool 的唯一名称。Codex 会通过这个名字调用工具。

推荐命名方式：

```text
服务前缀_动作_资源
```

例如：

```text
yhc_list_users
yhc_search_orders
yhc_get_order_detail
```

第二个参数是 tool config：

```ts
{
  title: "List Yinghuochong Users",
  description: "...",
  inputSchema: z.object({...}),
  annotations: {...}
}
```

`title` 是给人看的短标题。

`description` 是给模型看的工具说明，非常重要。Codex 会根据它判断什么时候应该调用这个工具。好的 `description` 应该说明：

- 这个工具做什么。
- 是只读还是会修改数据。
- 支持哪些查询条件。
- 返回什么类型的数据。

`inputSchema` 用 `zod` 定义工具入参：

```ts
inputSchema: z.object({
  keyword: z.string().trim().max(128).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  response_format: z.enum(["markdown", "json"]).default("json"),
})
```

这个 schema 同时有两个作用：

- 告诉 Codex 这个工具可以接收什么参数。
- 在真正调用工具前做参数校验，防止传入非法值。

`annotations` 是 MCP 给客户端的行为提示：

```ts
annotations: {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}
```

含义：

- `readOnlyHint: true`：工具只读，不会修改外部状态。
- `destructiveHint: false`：工具不会删除、覆盖、清空数据。
- `idempotentHint: true`：同样参数调用多次，不会产生额外副作用。
- `openWorldHint: true`：工具会访问外部世界，例如数据库、网络或文件系统。

注意：`annotations` 只是提示，不是安全机制。真正的安全限制仍然要靠代码实现，例如数据库白名单、参数化查询、不暴露任意 SQL。

第三个参数是 handler：

```ts
async ({ database, keyword, limit, offset, response_format }) => {
  // 查询数据库并返回 MCP result
}
```

handler 接收的参数就是 `inputSchema` 校验后的结果。

返回值一般包含：

```ts
return {
  content: [
    {
      type: "text",
      text: JSON.stringify(output, null, 2),
    },
  ],
  structuredContent: output,
};
```

`content` 是 MCP 标准返回内容，通常给模型或用户阅读。

`structuredContent` 是结构化返回，适合 MCP client 或模型继续处理。

以 `yhc_list_users` 为例：

```ts
server.registerTool(
  "yhc_list_users",
  {
    title: "List Yinghuochong Users",
    description:
      "List read-only Yinghuochong users with pagination and optional keyword, nickname, or phone-tail filtering. Includes lightweight order and asset counts.",
    inputSchema: z.object({
      database: databaseSchema,
      keyword: z.string().trim().max(128).optional(),
      nickname: z.string().trim().max(64).optional(),
      phone_tail: z.string().trim().max(16).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
      response_format: z.enum(["markdown", "json"]).default("json"),
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ database, keyword, nickname, phone_tail, limit, offset, response_format }) => {
    // 查询 users 表，并返回分页后的用户列表。
  },
);
```

可以理解成：

```text
注册一个叫 yhc_list_users 的只读工具。

它可以接收：
- database
- keyword
- nickname
- phone_tail
- limit
- offset
- response_format

调用时会查询 users 表，并返回分页后的用户列表。
```

一句话总结：

```text
registerTool = 工具名 + 工具说明/参数定义 + 真正执行逻辑
```

对于 MCP 来说，`description` 和 `inputSchema` 写得越清楚，Codex 越容易正确调用你的工具。
