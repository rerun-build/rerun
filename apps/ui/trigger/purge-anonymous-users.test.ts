import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/supabase/serviceRole";
import { fakeSupabase, type SupabaseCall, type SupabaseResult } from "@/test/supabase-fake";
import { runContext } from "@/test/trigger-sdk";
import { purgeAnonymousUsers, purgeAnonymousUsersDaily } from "./purge-anonymous-users";

vi.mock("@trigger.dev/sdk/v3", async () => (await import("@/test/trigger-sdk")).triggerSdkMock());
vi.mock("@/supabase/serviceRole", () => ({ createServiceRoleClient: vi.fn() }));

const NOW = new Date("2026-09-20T12:00:00.000Z");
const HOUR = 60 * 60_000;

type AuthUser = { id: string; is_anonymous: boolean; created_at: string };

function anonymous(id: string, createdAt: Date, isAnonymous = true): AuthUser {
    return { id, is_anonymous: isAnonymous, created_at: createdAt.toISOString() };
}

function authAdmin(initial: AuthUser[], failingIds: string[] = []) {
    const live = [...initial];
    return {
        live,
        listUsers: vi.fn(async ({ page, perPage }: { page: number; perPage: number }) => ({ data: { users: live.slice((page - 1) * perPage, page * perPage) }, error: null })),
        deleteUser: vi.fn(async (id: string) => {
            if (failingIds.includes(id)) return { error: { message: "still referenced" } };
            live.splice(
                live.findIndex(user => user.id === id),
                1,
            );
            return { error: null };
        }),
    };
}

type Tables = { memberships?: Record<string, number[]>; sandbox?: number[]; memberCounts?: Record<number, number>; spaceCounts?: Record<number, number>; workspaceDeleteError?: boolean };

function filterValue(calls: readonly SupabaseCall[], column: string) {
    return calls.find(call => call.method === "eq" && call.args[0] === column)?.args[1];
}

function database(auth: ReturnType<typeof authAdmin>, tables: Tables = {}) {
    const db = fakeSupabase((table, calls): SupabaseResult => {
        const isCount = calls.some(call => call.method === "select" && (call.args[1] as { head?: boolean } | undefined)?.head);
        const isDelete = calls.some(call => call.method === "delete");
        if (table === "workspace_members" && isCount) return { count: tables.memberCounts?.[filterValue(calls, "workspace_id") as number] ?? 0 };
        if (table === "workspace_members") return { data: (tables.memberships?.[filterValue(calls, "user_id") as string] ?? []).map(workspace_id => ({ workspace_id })) };
        if (table === "spaces") return { count: tables.spaceCounts?.[filterValue(calls, "workspace_id") as number] ?? 0 };
        if (table === "workspaces" && isDelete) return tables.workspaceDeleteError ? { error: { message: "fk violation" } } : {};
        if (table === "workspaces") return { data: { is_sandbox: tables.sandbox?.includes(filterValue(calls, "id") as number) ?? false } };
        return {};
    });
    Object.assign(db.client, { auth: { admin: auth } });
    return db;
}

type Run = (payload: unknown, params: unknown) => Promise<{ scanned: number; deletedUsers: number; deletedWorkspaces: number; errors: number }>;
const purge = (payload: unknown = {}) => ((purgeAnonymousUsers as unknown as { run: Run }).run)(payload, runContext());

describe("purgeAnonymousUsers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW);
    });
    afterEach(() => vi.useRealTimers());

    it("defaults to anonymous accounts older than 24 hours", async () => {
        const auth = authAdmin([anonymous("old", new Date(NOW.getTime() - 25 * HOUR)), anonymous("recent", new Date(NOW.getTime() - 23 * HOUR)), anonymous("real", new Date(NOW.getTime() - 48 * HOUR), false)]);
        vi.mocked(createServiceRoleClient).mockReturnValue(database(auth).client);

        await expect(purge()).resolves.toMatchObject({ scanned: 1, deletedUsers: 1 });
        expect(auth.deleteUser).toHaveBeenCalledWith("old");
    });

    it("treats createdAfter as inclusive and createdBefore as exclusive", async () => {
        const auth = authAdmin([
            anonymous("before-after", new Date("2026-09-10T23:59:59.999Z")),
            anonymous("at-after", new Date("2026-09-11T00:00:00.000Z")),
            anonymous("inside", new Date("2026-09-11T12:00:00.000Z")),
            anonymous("at-before", new Date("2026-09-12T00:00:00.000Z")),
        ]);
        vi.mocked(createServiceRoleClient).mockReturnValue(database(auth).client);

        await purge({ createdAfter: "2026-09-11T00:00:00.000Z", createdBefore: "2026-09-12T00:00:00.000Z" });

        expect(auth.deleteUser.mock.calls.map(([id]) => id)).toEqual(["at-after", "inside"]);
    });

    it("reaches every account when deletions shift the pages", async () => {
        const users = Array.from({ length: 1500 }, (_, index) => anonymous(`u${index}`, new Date(NOW.getTime() - 48 * HOUR)));
        const auth = authAdmin(users);
        vi.mocked(createServiceRoleClient).mockReturnValue(database(auth).client);

        await expect(purge()).resolves.toMatchObject({ scanned: 1500, deletedUsers: 1500 });
        expect(auth.live).toEqual([]);
    });

    it("counts a failed deletion and carries on", async () => {
        const old = new Date(NOW.getTime() - 48 * HOUR);
        const auth = authAdmin([anonymous("stuck", old), anonymous("fine", old)], ["stuck"]);
        vi.mocked(createServiceRoleClient).mockReturnValue(database(auth).client);

        await expect(purge()).resolves.toMatchObject({ scanned: 2, deletedUsers: 1, errors: 1 });
    });

    it("fails the run when the user list cannot be read", async () => {
        const auth = authAdmin([]);
        auth.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: { message: "gotrue down" } } as never);
        vi.mocked(createServiceRoleClient).mockReturnValue(database(auth).client);

        await expect(purge()).rejects.toThrow("gotrue down");
    });

    describe("orphaned workspaces", () => {
        const old = new Date(NOW.getTime() - 48 * HOUR);

        it("deletes a workspace left with no member and no Box", async () => {
            const auth = authAdmin([anonymous("a", old)]);
            const db = database(auth, { memberships: { a: [7] } });
            vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

            await expect(purge()).resolves.toMatchObject({ deletedWorkspaces: 1 });
            expect(db.writes("workspaces")).toEqual([{ method: "delete", payload: undefined, filters: [{ table: "workspaces", method: "eq", args: ["id", 7] }] }]);
        });

        it("keeps a workspace that still has a member", async () => {
            const auth = authAdmin([anonymous("a", old)]);
            const db = database(auth, { memberships: { a: [7] }, memberCounts: { 7: 1 } });
            vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

            await expect(purge()).resolves.toMatchObject({ deletedWorkspaces: 0 });
            expect(db.writes("workspaces")).toEqual([]);
        });

        it("keeps a workspace that still has a Box", async () => {
            const auth = authAdmin([anonymous("a", old)]);
            const db = database(auth, { memberships: { a: [7] }, spaceCounts: { 7: 2 } });
            vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

            await expect(purge()).resolves.toMatchObject({ deletedWorkspaces: 0 });
            expect(db.writes("workspaces")).toEqual([]);
        });

        it("counts members on every column, which workspace_members needs having no id", async () => {
            const auth = authAdmin([anonymous("a", old)]);
            const db = database(auth, { memberships: { a: [7] } });
            vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

            await purge();

            const count = db.chainsOn("workspace_members").find(chain => chain.some(call => call.method === "select" && (call.args[1] as { head?: boolean } | undefined)?.head));
            expect(count?.find(call => call.method === "select")?.args[0]).toBe("*");
        });

        it("never deletes a sandbox", async () => {
            const auth = authAdmin([anonymous("a", old)]);
            const db = database(auth, { memberships: { a: [7] }, sandbox: [7] });
            vi.mocked(createServiceRoleClient).mockReturnValue(db.client);

            await expect(purge()).resolves.toMatchObject({ deletedWorkspaces: 0 });
            expect(db.writes("workspaces")).toEqual([]);
        });

        it("counts a failed workspace deletion", async () => {
            const auth = authAdmin([anonymous("a", old)]);
            vi.mocked(createServiceRoleClient).mockReturnValue(database(auth, { memberships: { a: [7] }, workspaceDeleteError: true }).client);

            await expect(purge()).resolves.toMatchObject({ deletedWorkspaces: 0, errors: 1 });
        });
    });

    it("runs nightly over the default window", async () => {
        const auth = authAdmin([anonymous("old", new Date(NOW.getTime() - 25 * HOUR))]);
        vi.mocked(createServiceRoleClient).mockReturnValue(database(auth).client);

        await expect(((purgeAnonymousUsersDaily as unknown as { run: Run }).run)({}, runContext())).resolves.toMatchObject({ deletedUsers: 1 });
    });
});
