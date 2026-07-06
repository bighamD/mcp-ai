import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getDbConfig, queryRows, quoteIdentifier, resolveDatabase } from "../db.js";
import { boolMeta, jsonText, moneyFromCents, type ResponseFormat } from "../format.js";

const responseFormatSchema = z.enum(["markdown", "json"]).default("markdown");
const databaseSchema = z
  .string()
  .min(1)
  .max(128)
  .optional()
  .describe("Optional database name. Must be in YHC_ALLOWED_DATABASES.");

type CountRow = { total: number } & Record<string, unknown>;

interface DatabaseTableRow {
  table_schema: string;
  table_name: string;
  table_rows: number | null;
}

interface OrderRow {
  id: number;
  order_no: string;
  parent_order_id: number | null;
  order_role: string;
  status: string;
  buyer_openid: string;
  buyer_nickname: string | null;
  buyer_phone: string | null;
  total_amount_cents: number;
  payment_mode: string;
  paid_amount_cents: number | null;
  wechat_transaction_id: string | null;
  created_at: string | null;
  paid_at: string | null;
}

interface OrderItemRow {
  id: number;
  item_source: string;
  product_id: number | null;
  activity_id: number | null;
  quantity: number;
  unit_price_cents: number;
  title_snapshot: string | null;
  image_url_snapshot: string | null;
  rules_snapshot: string | null;
}

interface AssetRow {
  id: number;
  code: string | null;
  status: string;
  product_id: number | null;
  total_count?: number | null;
  remaining_count?: number | null;
  expires_at?: string | null;
  created_at: string | null;
}

interface RefundRow {
  id: number;
  out_refund_no: string;
  status: string;
  refund_amount_cents: number;
  reason: string | null;
  requested_at: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
}

interface UserRow {
  id: number;
  openid: string;
  nickname: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string | null;
  order_count: number;
  paid_order_count: number;
  paid_total_amount_cents: number;
  pass_card_count: number;
  ticket_count: number;
  last_order_created_at: string | null;
}

function successResult(output: Record<string, unknown>, format: ResponseFormat, markdown: string) {
  return {
    content: [{ type: "text" as const, text: format === "json" ? jsonText(output) : markdown }],
    structuredContent: output,
  };
}

function errorResult(error: unknown, hint?: string) {
  const message = error instanceof Error ? error.message : String(error);
  const suffix = hint ? ` ${hint}` : "";
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}.${suffix}` }],
  };
}

function dbPrefix(database: string): string {
  return quoteIdentifier(database);
}

function compactOrder(row: OrderRow) {
  return {
    id: row.id,
    order_no: row.order_no,
    parent_order_id: row.parent_order_id,
    order_role: row.order_role,
    status: row.status,
    buyer_openid: row.buyer_openid,
    buyer_nickname: row.buyer_nickname || "",
    buyer_phone: row.buyer_phone || "",
    total_amount_cents: row.total_amount_cents,
    total_amount: moneyFromCents(row.total_amount_cents),
    payment_mode: row.payment_mode,
    paid_amount_cents: row.paid_amount_cents,
    paid_amount: row.paid_amount_cents == null ? null : moneyFromCents(row.paid_amount_cents),
    wechat_transaction_id: row.wechat_transaction_id,
    created_at: row.created_at,
    paid_at: row.paid_at,
  };
}

export function registerYhcTools(server: McpServer): void {
  server.registerTool(
    "yhc_list_databases",
    {
      title: "List Yinghuochong Databases",
      description:
        "List allowed Yinghuochong MySQL databases and their table row estimates. This is read-only and only reports databases configured in YHC_ALLOWED_DATABASES.",
      inputSchema: z.object({
        response_format: responseFormatSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      try {
        const config = getDbConfig();
        const placeholders = config.allowedDatabases.map(() => "?").join(", ");
        const rows = await queryRows<DatabaseTableRow>(
          `SELECT table_schema, table_name, table_rows
           FROM information_schema.tables
           WHERE table_schema IN (${placeholders})
           ORDER BY table_schema, table_name`,
          config.allowedDatabases,
        );
        const databases = config.allowedDatabases.map((name) => {
          const tables = rows
            .filter((row) => row.table_schema === name)
            .map((row) => ({
              table_name: row.table_name,
              estimated_rows: row.table_rows ?? 0,
            }));
          return {
            name,
            is_default: name === config.defaultDatabase,
            table_count: tables.length,
            tables,
          };
        });
        const output = { default_database: config.defaultDatabase, databases };
        const markdown = [
          `# Yinghuochong Databases`,
          "",
          `Default: \`${config.defaultDatabase}\``,
          "",
          ...databases.flatMap((db) => [
            `## ${db.name}${db.is_default ? " (default)" : ""}`,
            `Tables: ${db.table_count}`,
            ...db.tables.map((table) => `- ${table.table_name}: ~${table.estimated_rows} rows`),
            "",
          ]),
        ].join("\n");
        return successResult(output, response_format, markdown);
      } catch (error) {
        return errorResult(error, "Check MySQL is listening and DB env vars are correct.");
      }
    },
  );

  server.registerTool(
    "yhc_search_orders",
    {
      title: "Search Yinghuochong Orders",
      description:
        "Search read-only Yinghuochong orders by order number, buyer openid, nickname, phone, status, and order role. Results are paginated and ordered by newest order id.",
      inputSchema: z.object({
        database: databaseSchema,
        keyword: z.string().trim().max(128).optional().describe("Matches order_no, openid, nickname, or phone."),
        status: z
          .enum(["pending_pay", "paid", "cancelled", "refunded"])
          .optional()
          .describe("Optional order status filter."),
        order_role: z.enum(["business", "payment", "all"]).default("business"),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
        response_format: responseFormatSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ database, keyword, status, order_role, limit, offset, response_format }) => {
      try {
        const selectedDb = resolveDatabase(database);
        const db = dbPrefix(selectedDb);
        const where: string[] = [];
        const params: Array<string | number> = [];

        if (order_role !== "all") {
          where.push("o.order_role = ?");
          params.push(order_role);
        }
        if (status) {
          where.push("o.status = ?");
          params.push(status);
        }
        if (keyword) {
          const like = `%${keyword}%`;
          where.push("(o.order_no LIKE ? OR o.openid LIKE ? OR u.nickname LIKE ? OR u.phone LIKE ?)");
          params.push(like, like, like, like);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const countRows = await queryRows<CountRow>(
          `SELECT COUNT(*) AS total
           FROM ${db}.orders o
           LEFT JOIN ${db}.users u ON u.openid = o.openid
           ${whereSql}`,
          params,
        );
        const total = Number(countRows[0]?.total ?? 0);
        const rows = await queryRows<OrderRow>(
          `SELECT
             o.id, o.order_no, o.parent_order_id, o.order_role, o.status,
             o.openid AS buyer_openid, u.nickname AS buyer_nickname, u.phone AS buyer_phone,
             o.total_amount_cents, o.payment_mode, o.paid_amount_cents,
             o.wechat_transaction_id, o.created_at, o.paid_at
           FROM ${db}.orders o
           LEFT JOIN ${db}.users u ON u.openid = o.openid
           ${whereSql}
           ORDER BY o.id DESC
           LIMIT ? OFFSET ?`,
          [...params, limit, offset],
        );

        const items = rows.map(compactOrder);
        const output = {
          database: selectedDb,
          total,
          count: items.length,
          offset,
          ...boolMeta(total, offset, items.length),
          items,
        };
        const markdown = [
          `# Order Search`,
          "",
          `Database: \`${selectedDb}\``,
          `Found ${total} order(s), showing ${items.length}.`,
          "",
          ...items.map(
            (order) =>
              `- ${order.order_no} | ${order.status} | ${order.total_amount} | ${order.buyer_nickname || order.buyer_openid} | ${order.created_at ?? ""}`,
          ),
        ].join("\n");
        return successResult(output, response_format, markdown);
      } catch (error) {
        return errorResult(error, "Try reducing filters or verify the selected database exists.");
      }
    },
  );

  server.registerTool(
    "yhc_get_order_detail",
    {
      title: "Get Yinghuochong Order Detail",
      description:
        "Get read-only detail for one Yinghuochong order by order_no, including buyer, line items, child orders, tickets, pass cards, and refunds when present.",
      inputSchema: z.object({
        database: databaseSchema,
        order_no: z.string().trim().min(1).max(64).describe("Exact order_no to inspect."),
        response_format: responseFormatSchema,
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ database, order_no, response_format }) => {
      try {
        const selectedDb = resolveDatabase(database);
        const db = dbPrefix(selectedDb);
        const orders = await queryRows<OrderRow>(
          `SELECT
             o.id, o.order_no, o.parent_order_id, o.order_role, o.status,
             o.openid AS buyer_openid, u.nickname AS buyer_nickname, u.phone AS buyer_phone,
             o.total_amount_cents, o.payment_mode, o.paid_amount_cents,
             o.wechat_transaction_id, o.created_at, o.paid_at
           FROM ${db}.orders o
           LEFT JOIN ${db}.users u ON u.openid = o.openid
           WHERE o.order_no = ?
           LIMIT 1`,
          [order_no],
        );

        if (!orders.length) {
          const output = { database: selectedDb, order_no, found: false };
          return successResult(output, response_format, `No order found for \`${order_no}\` in \`${selectedDb}\`.`);
        }

        const order = orders[0];
        const [items, childOrders, tickets, passCards, refunds] = await Promise.all([
          queryRows<OrderItemRow>(
            `SELECT id, item_source, product_id, activity_id, quantity, unit_price_cents,
                    title_snapshot, image_url_snapshot, rules_snapshot
             FROM ${db}.order_items
             WHERE order_id = ?
             ORDER BY id`,
            [order.id],
          ),
          queryRows<OrderRow>(
            `SELECT
               o.id, o.order_no, o.parent_order_id, o.order_role, o.status,
               o.openid AS buyer_openid, u.nickname AS buyer_nickname, u.phone AS buyer_phone,
               o.total_amount_cents, o.payment_mode, o.paid_amount_cents,
               o.wechat_transaction_id, o.created_at, o.paid_at
             FROM ${db}.orders o
             LEFT JOIN ${db}.users u ON u.openid = o.openid
             WHERE o.parent_order_id = ?
             ORDER BY o.id`,
            [order.id],
          ),
          queryRows<AssetRow>(
            `SELECT id, ticket_code AS code, status, product_id, created_at
             FROM ${db}.tickets
             WHERE order_id = ?
             ORDER BY id`,
            [order.id],
          ),
          queryRows<AssetRow>(
            `SELECT id, card_code AS code, status, product_id, total_count, remaining_count, expires_at, created_at
             FROM ${db}.pass_cards
             WHERE order_id = ?
             ORDER BY id`,
            [order.id],
          ),
          queryRows<RefundRow>(
            `SELECT id, out_refund_no, status, refund_amount_cents, reason,
                    requested_at, succeeded_at, failed_at, failure_reason
             FROM ${db}.order_refunds
             WHERE order_id = ? OR parent_order_id = ?
             ORDER BY id DESC`,
            [order.id, order.id],
          ),
        ]);

        const normalizedItems = items.map((item) => ({
          ...item,
          unit_price: moneyFromCents(item.unit_price_cents),
          line_total_cents: item.unit_price_cents * item.quantity,
          line_total: moneyFromCents(item.unit_price_cents * item.quantity),
        }));
        const output = {
          database: selectedDb,
          found: true,
          order: compactOrder(order),
          items: normalizedItems,
          child_orders: childOrders.map(compactOrder),
          tickets,
          pass_cards: passCards,
          refunds: refunds.map((refund) => ({
            ...refund,
            refund_amount: moneyFromCents(refund.refund_amount_cents),
          })),
        };
        const markdown = [
          `# Order ${order.order_no}`,
          "",
          `- Status: ${order.status}`,
          `- Buyer: ${order.buyer_nickname || ""} (${order.buyer_openid})`,
          `- Phone: ${order.buyer_phone || ""}`,
          `- Total: ${moneyFromCents(order.total_amount_cents)}`,
          `- Created: ${order.created_at ?? ""}`,
          `- Paid: ${order.paid_at ?? ""}`,
          "",
          `## Items`,
          ...normalizedItems.map(
            (item) => `- ${item.title_snapshot || item.item_source} x${item.quantity}: ${item.line_total}`,
          ),
          "",
          `## Assets`,
          `- Tickets: ${tickets.length}`,
          `- Pass cards: ${passCards.length}`,
          `- Child orders: ${childOrders.length}`,
          `- Refunds: ${refunds.length}`,
        ].join("\n");
        return successResult(output, response_format, markdown);
      } catch (error) {
        return errorResult(error, "Check the order_no and selected database.");
      }
    },
  );

  server.registerTool(
    "yhc_list_users",
    {
      title: "List Yinghuochong Users",
      description:
        "List read-only Yinghuochong users with pagination and optional keyword, nickname, or phone-tail filtering. Includes lightweight order and asset counts.",
      inputSchema: z.object({
        database: databaseSchema,
        keyword: z.string().trim().max(128).optional().describe("Matches openid, nickname, or phone."),
        nickname: z.string().trim().max(64).optional().describe("Partial nickname filter."),
        phone_tail: z.string().trim().max(16).optional().describe("Matches users whose phone ends with this value."),
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
      try {
        const selectedDb = resolveDatabase(database);
        const db = dbPrefix(selectedDb);
        const where: string[] = [];
        const params: Array<string | number> = [];

        if (keyword) {
          const like = `%${keyword}%`;
          where.push("(u.openid LIKE ? OR u.nickname LIKE ? OR u.phone LIKE ?)");
          params.push(like, like, like);
        }
        if (nickname) {
          where.push("u.nickname LIKE ?");
          params.push(`%${nickname}%`);
        }
        if (phone_tail) {
          where.push("u.phone LIKE ?");
          params.push(`%${phone_tail}`);
        }

        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
        const countRows = await queryRows<CountRow>(
          `SELECT COUNT(*) AS total FROM ${db}.users u ${whereSql}`,
          params,
        );
        const total = Number(countRows[0]?.total ?? 0);
        const rows = await queryRows<UserRow>(
          `SELECT
             u.id, u.openid, u.nickname, u.phone, u.avatar_url, u.created_at,
             COALESCE(om.order_count, 0) AS order_count,
             COALESCE(om.paid_order_count, 0) AS paid_order_count,
             COALESCE(om.paid_total_amount_cents, 0) AS paid_total_amount_cents,
             COALESCE(pm.pass_card_count, 0) AS pass_card_count,
             COALESCE(tm.ticket_count, 0) AS ticket_count,
             om.last_order_created_at
           FROM ${db}.users u
           LEFT JOIN (
             SELECT openid,
                    COUNT(*) AS order_count,
                    SUM(status = 'paid') AS paid_order_count,
                    SUM(CASE WHEN status = 'paid' THEN total_amount_cents ELSE 0 END) AS paid_total_amount_cents,
                    MAX(created_at) AS last_order_created_at
             FROM ${db}.orders
             GROUP BY openid
           ) om ON om.openid = u.openid
           LEFT JOIN (
             SELECT openid, COUNT(*) AS pass_card_count
             FROM ${db}.pass_cards
             GROUP BY openid
           ) pm ON pm.openid = u.openid
           LEFT JOIN (
             SELECT openid, COUNT(*) AS ticket_count
             FROM ${db}.tickets
             GROUP BY openid
           ) tm ON tm.openid = u.openid
           ${whereSql}
           ORDER BY u.id DESC
           LIMIT ? OFFSET ?`,
          [...params, limit, offset],
        );

        const items = rows.map((user) => ({
          ...user,
          nickname: user.nickname || "",
          phone: user.phone || "",
          paid_total_amount: moneyFromCents(user.paid_total_amount_cents),
        }));
        const output = {
          database: selectedDb,
          total,
          count: items.length,
          offset,
          ...boolMeta(total, offset, items.length),
          items,
        };
        const markdown = [
          `# Users`,
          "",
          `Database: \`${selectedDb}\``,
          `Found ${total} user(s), showing ${items.length}.`,
          "",
          ...items.map(
            (user) =>
              `- #${user.id} ${user.nickname || "(no nickname)"} | ${user.phone || "no phone"} | ${user.openid} | paid ${user.paid_order_count}/${user.order_count}`,
          ),
        ].join("\n");
        return successResult(output, response_format, markdown);
      } catch (error) {
        return errorResult(error, "Try a smaller limit or verify the selected database exists.");
      }
    },
  );
}
