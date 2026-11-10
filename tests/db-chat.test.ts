import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, ids } from "./helpers/db";

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const as = <T>(uid: string, fn: () => Promise<T>) => asUser(db, uid, fn);
const failsWith = (fn: () => Promise<unknown>, text: RegExp) => expect(fn()).rejects.toThrow(text);

interface Overview { thread_id: string; kind: string; location_id: string | null; title: string | null; last_body: string | null; last_sender: string | null; unread: number; notify: string }
const overview = (uid: string) => as(uid, () => q<Overview>(`select * from public.chat_overview()`));
const send = (uid: string, thread: string, body: string, reply: string | null = null, mentions: string[] = []) =>
  as(uid, () => q<{ id: string }>(`select public.send_chat_message($1, $2, $3, $4::uuid[]) as id`, [thread, body, reply, mentions]));
const notes = (uid: string, type?: string) => q<{ type: string; params: Record<string, string> }>(
  `select type, params from public.notifications where user_id = $1 and ($2::text is null or type = $2) order by created_at`, [uid, type ?? null]);

let global: string, central: string, lido: string, lidoLoc: string, direct: string;

beforeAll(async () => {
  db = await createTestDb();
  lidoLoc = (await as(ids.stefano, () => q<{ v: string }>(`select public.save_location(null, 'Lido', '#12A594') as v`)))[0].v;
  await as(ids.stefano, () => q(`select public.set_employee_locations($1, $2::uuid[])`, [ids.giulia, [lidoLoc]]));
  const o = await overview(ids.stefano);
  global = o.find((t) => t.kind === "global")!.thread_id;
  central = o.find((t) => t.title === "Horti Magici")!.thread_id;
  lido = o.find((t) => t.title === "Lido")!.thread_id;
}, 60_000);
afterAll(async () => db.close());

describe("who sees which thread", () => {
  it("creates the global and location threads on demand, once", async () => {
    expect((await overview(ids.stefano)).filter((t) => t.kind === "global")).toHaveLength(1);
    expect(await q(`select 1 from public.chat_threads where kind = 'location'`)).toHaveLength(2);
  });

  it("shows employees only the locations they work at, admins all of them", async () => {
    expect((await overview(ids.stefano)).map((t) => t.title)).toEqual(expect.arrayContaining(["Horti Magici", "Lido"]));
    const marco = (await overview(ids.marco)).map((t) => t.title);
    expect(marco).toContain("Horti Magici");
    expect(marco).not.toContain("Lido");
    const giulia = (await overview(ids.giulia)).map((t) => t.title);
    expect(giulia).toContain("Lido");
    expect(giulia).not.toContain("Horti Magici");
  });

  it("refuses to read or write a thread you cannot access", async () => {
    await send(ids.stefano, lido, "solo Lido");
    expect(await as(ids.marco, () => q(`select 1 from public.chat_messages where thread_id = $1`, [lido]))).toHaveLength(0);
    await failsWith(() => send(ids.marco, lido, "intruso"), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`select public.mark_chat_read($1)`, [lido])), /forbidden/);
    await failsWith(() => as(ids.marco, () => q(`insert into public.chat_messages (thread_id, sender_id, body) values ($1, $2, 'x')`, [central, ids.marco])), /permission denied/);
  });

  it("drops an archived location's thread from view", async () => {
    const tmp = (await as(ids.stefano, () => q<{ v: string }>(`select public.save_location(null, 'Temp', '#123456') as v`)))[0].v;
    const t = (await overview(ids.stefano)).find((x) => x.title === "Temp")!.thread_id;
    await as(ids.stefano, () => q(`select public.set_location_active($1, false)`, [tmp]));
    expect((await overview(ids.stefano)).some((x) => x.thread_id === t)).toBe(false);
    await failsWith(() => send(ids.stefano, t, "ciao"), /forbidden/);
  });
});

describe("direct messages", () => {
  it("opens one private thread per pair, whoever starts it", async () => {
    direct = (await as(ids.marco, () => q<{ v: string }>(`select public.open_direct_thread($1) as v`, [ids.giulia])))[0].v;
    const again = (await as(ids.giulia, () => q<{ v: string }>(`select public.open_direct_thread($1) as v`, [ids.marco])))[0].v;
    expect(again).toBe(direct);
    await failsWith(() => as(ids.marco, () => q(`select public.open_direct_thread($1)`, [ids.marco])), /invalid_input/);
  });

  it("is visible to the two people only, with the other person's name as title", async () => {
    await send(ids.marco, direct, "ci scambiamo il turno?");
    expect((await overview(ids.giulia)).find((t) => t.thread_id === direct)).toMatchObject({ title: "Marco Test", last_body: "ci scambiamo il turno?", last_sender: "Marco Test" });
    expect((await overview(ids.marco)).find((t) => t.thread_id === direct)?.title).toBe("Giulia Test");
    expect((await overview(ids.tessa)).some((t) => t.thread_id === direct)).toBe(false); // not even admins read private chats
    expect(await as(ids.tessa, () => q(`select 1 from public.chat_messages where thread_id = $1`, [direct]))).toHaveLength(0);
  });

  it("lets anyone find colleagues by name", async () => {
    const people = await as(ids.marco, () => q<{ name: string }>(`select * from public.chat_people()`));
    expect(people.map((p) => p.name).sort()).toEqual(["Giulia Test", "Stefano Test", "Tessa Test"]);
  });
});

describe("messages, unread and notifications", () => {
  it("counts unread per person and clears it on read", async () => {
    await send(ids.stefano, global, "Benvenuti!");
    expect((await overview(ids.marco)).find((t) => t.thread_id === global)!.unread).toBe(1);
    await as(ids.marco, () => q(`select public.mark_chat_read($1)`, [global]));
    expect((await overview(ids.marco)).find((t) => t.thread_id === global)!.unread).toBe(0);
    expect((await overview(ids.stefano)).find((t) => t.thread_id === global)!.unread).toBe(0); // own messages never count
  });

  it("notifies once per thread until it is read, so a busy chat does not flood the bell", async () => {
    await send(ids.stefano, central, "uno");
    await send(ids.stefano, central, "due");
    await send(ids.stefano, central, "tre");
    expect(await notes(ids.marco, "chat_message").then((r) => r.filter((n) => n.params.thread_id === central))).toHaveLength(1);
    await as(ids.marco, () => q(`select public.mark_chat_read($1)`, [central]));
    await send(ids.stefano, central, "quattro");
    expect(await notes(ids.marco, "chat_message").then((r) => r.filter((n) => n.params.thread_id === central))).toHaveLength(2);
  });

  it("a mention always notifies, with the sender's name and a preview", async () => {
    await send(ids.stefano, central, "ciao @Marco domani alle 10", null, [ids.marco]);
    const m = (await notes(ids.marco, "chat_mention"))[0];
    expect(m.params).toMatchObject({ employee_name: "Stefano Test", thread_id: central });
    expect(m.params.preview).toContain("domani");
  });

  it("ignores mentions of people who are not in the thread", async () => {
    await send(ids.stefano, central, "ehi @Giulia", null, [ids.giulia]); // Giulia only works at Lido
    expect(await notes(ids.giulia, "chat_mention")).toHaveLength(0);
  });

  it("respects per-thread settings: mentions-only and muted", async () => {
    await as(ids.marco, () => q(`select public.mark_chat_read($1)`, [central]));
    await as(ids.marco, () => q(`select public.set_chat_notify($1, 'mentions')`, [central]));
    const before = (await notes(ids.marco)).length;
    await send(ids.stefano, central, "messaggio normale");
    expect((await notes(ids.marco)).length).toBe(before);
    await send(ids.stefano, central, "@Marco serve te", null, [ids.marco]);
    expect((await notes(ids.marco)).length).toBe(before + 1);
    await as(ids.marco, () => q(`select public.set_chat_notify($1, 'none')`, [central]));
    await send(ids.stefano, central, "@Marco di nuovo", null, [ids.marco]);
    expect((await notes(ids.marco)).length).toBe(before + 1); // muted beats mentions
    expect((await overview(ids.marco)).find((t) => t.thread_id === central)!.notify).toBe("none");
    await failsWith(() => as(ids.marco, () => q(`select public.set_chat_notify($1, 'loud')`, [central])), /invalid_input/);
  });

  it("marking a thread read also clears its bell notifications", async () => {
    await as(ids.giulia, () => q(`select public.set_chat_notify($1, 'all')`, [lido]));
    await send(ids.stefano, lido, "per Giulia");
    const unread = () => q(`select 1 from public.notifications where user_id = $1 and read_at is null and type = 'chat_message' and params ->> 'thread_id' = $2`, [ids.giulia, lido]);
    expect((await unread()).length).toBe(1);
    await as(ids.giulia, () => q(`select public.mark_chat_read($1)`, [lido]));
    expect(await unread()).toHaveLength(0);
  });

  it("validates the text", async () => {
    await failsWith(() => send(ids.stefano, global, "   "), /invalid_input/);
    await failsWith(() => send(ids.stefano, global, "x".repeat(2001)), /invalid_input/);
    await failsWith(() => send(ids.stefano, global, "ok", "00000000-0000-4000-8000-0000000000aa"), /invalid_input/);
  });
});

describe("announcement mode in location threads", () => {
  it("employees may only reply when the option is on; admins and other threads are unaffected", async () => {
    await failsWith(() => as(ids.marco, () => q(`select public.save_chat_options(true)`)), /forbidden/);
    await as(ids.stefano, () => q(`select public.save_chat_options(true)`));
    const root = (await send(ids.stefano, central, "Annuncio: lunedì chiuso"))[0].id;
    await failsWith(() => send(ids.marco, central, "nuovo argomento"), /broadcast_only/);
    await send(ids.marco, central, "ricevuto", root);
    await send(ids.marco, global, "in globale posso scrivere"); // only location threads are announcement-only
    await send(ids.stefano, central, "gli admin scrivono liberamente");
    await as(ids.stefano, () => q(`select public.save_chat_options(false)`));
    await send(ids.marco, central, "ora posso di nuovo");
  });

  it("a reply must point at a message of the same thread", async () => {
    const other = (await send(ids.stefano, global, "messaggio globale"))[0].id;
    await failsWith(() => send(ids.marco, central, "risposta sbagliata", other), /invalid_input/);
  });
});

describe("deleting and the 90-day purge", () => {
  it("lets the author or an admin delete a message, nobody else", async () => {
    const id = (await send(ids.marco, global, "oops"))[0].id;
    await failsWith(() => as(ids.giulia, () => q(`select public.delete_chat_message($1)`, [id])), /not_found/);
    await as(ids.marco, () => q(`select public.delete_chat_message($1)`, [id]));
    const id2 = (await send(ids.marco, global, "da moderare"))[0].id;
    await as(ids.tessa, () => q(`select public.delete_chat_message($1)`, [id2]));
    expect(await q(`select 1 from public.chat_messages where id = any($1::uuid[])`, [[id, id2]])).toHaveLength(0);
  });

  it("purges only old chat messages and notification logs, and nothing else", async () => {
    await as(ids.stefano, () => q(`select public.save_shift(null, $1, '2030-02-05', '10:00', '14:00', '', '', true, 'x')`, [ids.marco]));
    await as(ids.stefano, () => q(`select public.publish_schedule('2030-02-04', null)`));
    const old = (await send(ids.stefano, global, "vecchio"))[0].id;
    await q(`update public.chat_messages set created_at = now() - interval '91 days' where id = $1`, [old]);
    await q(`update public.notifications set created_at = now() - interval '95 days' where id = (select id from public.notifications order by created_at limit 1)`);
    const keep = (await q(`select count(*)::int as n from public.chat_messages`))[0] as { n: number };

    await failsWith(() => as(ids.marco, () => q(`select public.purge_chat_now()`)), /forbidden/);
    const r = (await as(ids.stefano, () => q<{ r: { messages: number; notifications: number } }>(`select public.purge_chat_now() as r`)))[0].r;
    expect(r.messages).toBe(1);
    expect(r.notifications).toBeGreaterThanOrEqual(1);
    expect((await q(`select count(*)::int as n from public.chat_messages`))[0]).toEqual({ n: keep.n - 1 });
    // schedules, versions, shifts and the audit log are untouched
    expect(await q(`select 1 from public.weekly_schedules where status = 'published'`)).toHaveLength(1);
    expect(await q(`select 1 from public.schedule_versions`)).toHaveLength(1);
    expect(await q(`select 1 from public.shifts`)).toHaveLength(1);
    expect((await q(`select 1 from public.audit_logs where action = 'chat.purged'`)).length).toBe(1);
    // the last run is recorded for the settings screen
    const status = (await q<{ value: { messages: number } }>(`select value from public.app_settings where key = 'chat_purge'`))[0].value;
    expect(status.messages).toBe(1);
  });

  it("the cron entry point is not callable by signed-in users", async () => {
    await failsWith(() => as(ids.stefano, () => q(`select public.run_chat_purge(1)`)), /permission denied/);
  });
});
