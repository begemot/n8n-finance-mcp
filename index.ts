/**
 * MCP Finance Server — STDIO (n8n MCP Client совместим)
 * -----------------------------------------------------
 * Функционал:
 * - user.*: list/add/update/delete
 * - category.*: list/add/update/delete
 * - entry.*: list/add/update/delete
 * - balance.category.total, balance.category.period
 *
 * Запуск (dev):
 *   npm i @modelcontextprotocol/sdk zod
 *   npm i -D typescript tsx @types/node
 *   npx tsx index.ts
 *
 * Подключение в n8n (узел MCP Client):
 *   Server Transport: Command
 *   Command: npx
 *   Arguments: tsx index.ts
 *   Authentication: None
 *   Tools: загрузятся автоматически
 */

import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

type ID = string;

interface User { id: ID; name: string; email?: string; createdAt: string; }
interface Category { id: ID; userId: ID; name: string; createdAt: string; }
interface Entry {
  id: ID; userId: ID; categoryId: ID; kind: "income" | "expense";
  amount: number; currency?: string; timestamp: string; note?: string;
  createdAt: string; updatedAt?: string;
}
interface DB { users: User[]; categories: Category[]; entries: Entry[]; }

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), "mcp-finance-db.json");

async function ensureDB(): Promise<void> {
  try { await fs.access(DB_PATH); }
  catch { const empty: DB = { users: [], categories: [], entries: [] }; await fs.writeFile(DB_PATH, JSON.stringify(empty, null, 2), "utf-8"); }
}
async function readDB(): Promise<DB> { await ensureDB(); return JSON.parse(await fs.readFile(DB_PATH, "utf-8")) as DB; }
async function writeDB(db: DB): Promise<void> { await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf-8"); }

function uid(prefix = "id"): ID { return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`; }
function parseISO(s: string): Date { const d = new Date(s); if (isNaN(d.valueOf())) throw new Error(`Bad ISO date: ${s}`); return d; }
function sumBalance(entries: Entry[]): number { return entries.reduce((acc, e) => acc + (e.kind === "income" ? e.amount : -e.amount), 0); }

// -----------------------------
// Схемы Zod
// -----------------------------

const UserCreate = z.object({ name: z.string().min(1), email: z.string().email().optional() });
const UserUpdate = z.object({ id: z.string(), name: z.string().min(1).optional(), email: z.string().email().optional() });
const UserId = z.object({ id: z.string() });

const CategoryCreate = z.object({ userId: z.string(), name: z.string().min(1) });
const CategoryUpdate = z.object({ id: z.string(), name: z.string().min(1) });
const CategoryList = z.object({ userId: z.string() });
const CategoryId = z.object({ id: z.string() });

const EntryCreate = z.object({
  userId: z.string(), categoryId: z.string(), kind: z.enum(["income", "expense"]),
  amount: z.number().positive(), currency: z.string().optional(), timestamp: z.string().optional(), note: z.string().optional(),
});
const EntryUpdate = z.object({
  id: z.string(), userId: z.string().optional(), categoryId: z.string().optional(),
  kind: z.enum(["income", "expense"]).optional(), amount: z.number().positive().optional(),
  currency: z.string().optional(), timestamp: z.string().optional(), note: z.string().optional(),
});
const EntryList = z.object({ userId: z.string(), categoryId: z.string().optional(), start: z.string().optional(), end: z.string().optional() });
const EntryId = z.object({ id: z.string() });

const BalanceTotal = z.object({ userId: z.string(), categoryId: z.string() });
const BalancePeriod = z.object({ userId: z.string(), categoryId: z.string(), start: z.string(), end: z.string() });

// -----------------------------
// MCP Server (STDIO)
// -----------------------------

const server = new Server(
  { name: "mcp-finance-server", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

function addTool<I extends z.ZodTypeAny, O>(name: string, schema: I, description: string, fn: (input: z.infer<I>) => Promise<O> | O) {
  // @ts-ignore
  server.addTool?.({
    name,
    description,
    inputSchema: schema,
    execute: async ({ input }: { input: z.infer<I> }) => await fn(input),
  }) ?? (server as any).tool?.(name, { description, inputSchema: schema }, async (input: any) => fn(input));
}

// ---- Пользователи ----
addTool("user.list", z.object({}), "Список пользователей", async () => ({ users: (await readDB()).users }));

addTool("user.add", UserCreate, "Добавить пользователя", async ({ name, email }) => {
  const db = await readDB(); const now = new Date().toISOString();
  const user: User = { id: uid("usr"), name, email, createdAt: now }; db.users.push(user); await writeDB(db); return { user };
});

addTool("user.update", UserUpdate, "Изменить пользователя", async ({ id, name, email }) => {
  const db = await readDB(); const u = db.users.find(x => x.id === id); if (!u) throw new Error("User not found");
  if (name !== undefined) u.name = name; if (email !== undefined) u.email = email; await writeDB(db); return { user: u };
});

addTool("user.delete", UserId, "Удалить пользователя", async ({ id }) => {
  const db = await readDB(); const before = db.users.length;
  db.users = db.users.filter(u => u.id !== id); db.categories = db.categories.filter(c => c.userId !== id); db.entries = db.entries.filter(e => e.userId !== id);
  await writeDB(db); return { deleted: before !== db.users.length };
});

// ---- Категории ----
addTool("category.list", CategoryList, "Список категорий пользователя", async ({ userId }) => ({ categories: (await readDB()).categories.filter(c => c.userId === userId) }));

addTool("category.add", CategoryCreate, "Добавить категорию", async ({ userId, name }) => {
  const db = await readDB(); if (!db.users.find(u => u.id === userId)) throw new Error("User not found");
  const now = new Date().toISOString(); const cat: Category = { id: uid("cat"), userId, name, createdAt: now }; db.categories.push(cat); await writeDB(db); return { category: cat };
});

addTool("category.update", CategoryUpdate, "Переименовать категорию", async ({ id, name }) => {
  const db = await readDB(); const c = db.categories.find(x => x.id === id); if (!c) throw new Error("Category not found"); c.name = name; await writeDB(db); return { category: c };
});

addTool("category.delete", CategoryId, "Удалить категорию", async ({ id }) => {
  const db = await readDB(); const before = db.categories.length; db.categories = db.categories.filter(c => c.id !== id);
  db.entries = db.entries.map(e => (e.categoryId === id ? { ...e, categoryId: "" } : e)); await writeDB(db); return { deleted: before !== db.categories.length };
});

// ---- Записи ----
addTool("entry.list", EntryList, "Список записей", async ({ userId, categoryId, start, end }) => {
  const db = await readDB(); let items = db.entries.filter(e => e.userId === userId);
  if (categoryId) items = items.filter(e => e.categoryId === categoryId);
  if (start) items = items.filter(e => parseISO(e.timestamp) >= parseISO(start));
  if (end) items = items.filter(e => parseISO(e.timestamp) < parseISO(end));
  items.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)); return { entries: items };
});

addTool("entry.add", EntryCreate, "Добавить запись доход/расход", async ({ userId, categoryId, kind, amount, currency, timestamp, note }) => {
  const db = await readDB(); const u = db.users.find(x => x.id === userId); if (!u) throw new Error("User not found");
  if (categoryId) { const c = db.categories.find(x => x.id === categoryId && x.userId === userId); if (!c) throw new Error("Category not found for this user"); }
  const now = new Date().toISOString(); const ts = timestamp ? parseISO(timestamp).toISOString() : now;
  const e: Entry = { id: uid("ent"), userId, categoryId, kind, amount, currency, timestamp: ts, note, createdAt: now };
  db.entries.push(e); await writeDB(db); return { entry: e };
});

addTool("entry.update", EntryUpdate, "Изменить запись", async (payload) => {
  const db = await readDB(); const e = db.entries.find(x => x.id === payload.id); if (!e) throw new Error("Entry not found");
  if (payload.userId !== undefined) e.userId = payload.userId;
  if (payload.categoryId !== undefined) e.categoryId = payload.categoryId;
  if (payload.kind !== undefined) e.kind = payload.kind;
  if (payload.amount !== undefined) e.amount = payload.amount;
  if (payload.currency !== undefined) e.currency = payload.currency;
  if (payload.timestamp !== undefined) e.timestamp = parseISO(payload.timestamp).toISOString();
  if (payload.note !== undefined) e.note = payload.note; e.updatedAt = new Date().toISOString(); await writeDB(db); return { entry: e };
});

addTool("entry.delete", EntryId, "Удалить запись", async ({ id }) => {
  const db = await readDB(); const before = db.entries.length; db.entries = db.entries.filter(e => e.id !== id); await writeDB(db); return { deleted: before !== db.entries.length };
});

// ---- Балансы ----
addTool("balance.category.total", BalanceTotal, "Баланс по категории за всё время", async ({ userId, categoryId }) => {
  const db = await readDB(); const items = db.entries.filter(e => e.userId === userId && e.categoryId === categoryId); return { userId, categoryId, balance: sumBalance(items), count: items.length };
});

addTool("balance.category.period", BalancePeriod, "Баланс по категории за период", async ({ userId, categoryId, start, end }) => {
  const db = await readDB(); const s = parseISO(start), e = parseISO(end);
  const items = db.entries.filter(x => x.userId === userId && x.categoryId === categoryId && parseISO(x.timestamp) >= s && parseISO(x.timestamp) < e);
  return { userId, categoryId, start: s.toISOString(), end: e.toISOString(), balance: sumBalance(items), count: items.length };
});

// -----------------------------
// Запуск STDIO MCP-сервера
// -----------------------------

async function main() {
  await ensureDB();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mcp-finance-server] running via STDIO. DB: ${DB_PATH}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
