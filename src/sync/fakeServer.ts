/** In-memory stand-in for the sync server (`server/`), for tests. Same JSON contract. */
import type { SyncChange } from "@/data/syncLocal";

interface User {
  password: string;
  rows: Map<string, { table: string; key: string; row: unknown; seq: number }>;
  seq: number;
}

export function createFakeServer() {
  const users = new Map<string, User>();
  const tokens = new Map<string, string>();
  let n = 0;
  let down = false;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const err = (status: number, error: string) => json(status, { error, message: error });

  async function request(url: string, init: RequestInit): Promise<Response> {
    if (down) throw new TypeError("Failed to fetch");
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const auth = new Headers(init.headers).get("Authorization")?.replace("Bearer ", "");
    const username = auth ? tokens.get(auth) : undefined;
    const user = username ? users.get(username) : undefined;
    const issue = (name: string) => {
      const token = `t${++n}`;
      tokens.set(token, name);
      return json(200, { token, username: name });
    };
    switch (path) {
      case "/api/signup":
        if (users.has(body.username)) return err(409, "username_taken");
        users.set(body.username, { password: body.password, rows: new Map(), seq: 0 });
        return issue(body.username);
      case "/api/login":
        if (users.get(body.username)?.password !== body.password) return err(401, "bad_credentials");
        return issue(body.username);
    }
    if (!user || !username) return err(401, "unauthorized");
    switch (path) {
      case "/api/logout":
        tokens.delete(auth!);
        return json(200, {});
      case "/api/sync": {
        const pushedKeys = new Set<string>();
        for (const c of body.changes as SyncChange[]) {
          const k = `${c.table}\u0000${c.key}`;
          pushedKeys.add(k);
          user.rows.set(k, { table: c.table, key: c.key, row: c.row, seq: ++user.seq });
        }
        if (body.replace) {
          for (const [k, r] of user.rows) if (!pushedKeys.has(k) && r.row != null) user.rows.set(k, { ...r, row: null, seq: ++user.seq });
        }
        const changes = [...user.rows.values()]
          .filter((r) => r.seq > body.since)
          .sort((a, b) => a.seq - b.seq)
          .map(({ table, key, row }) => ({ table, key, row }));
        return json(200, { seq: user.seq, changes });
      }
    }
    return err(404, "bad_request");
  }

  return {
    request,
    users,
    setDown(v: boolean) {
      down = v;
    },
  };
}

export type FakeServer = ReturnType<typeof createFakeServer>;
