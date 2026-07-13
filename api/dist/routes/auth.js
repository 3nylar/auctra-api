import { z } from "zod";
import { prisma } from "../lib/db.js";
import { env } from "../lib/env.js";
import { errors } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { createSession, SESSION_COOKIE } from "../lib/session.js";
import { requireSession } from "../middleware/sessionAuth.js";
const credentialsSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8, "Password must be at least 8 characters."),
});
/**
 * Cookie options shared by every place that sets or clears the session
 * cookie. `sameSite: "none"` plus `secure: true` is required, not stylistic
 * — the dashboard and the API are on different domains (a vercel.app origin
 * calling a railway.app origin), and a cross-site fetch only carries a
 * cookie at all if the browser is told explicitly that's intended. Locking
 * CORS to exactly `DASHBOARD_ORIGIN` (see server.ts) is what keeps that
 * relaxation from being a blank check to every other site on the internet.
 */
const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
};
export async function authRoutes(app) {
    app.post("/v1/auth/signup", async (req, reply) => {
        const body = z
            .object({ org_name: z.string().min(1).max(200) })
            .and(credentialsSchema)
            .parse(req.body);
        const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
        if (existing)
            throw errors.emailTaken();
        const org = await prisma.organization.create({
            data: { name: body.org_name, env: env.AUCTRA_ENV },
        });
        const user = await prisma.user.create({
            data: {
                orgId: org.id,
                email: body.email.toLowerCase(),
                passwordHash: await hashPassword(body.password),
            },
        });
        const token = createSession({ userId: user.id, orgId: org.id });
        reply.setCookie(SESSION_COOKIE, token, cookieOpts);
        reply.code(201);
        return { object: "user", id: user.id, email: user.email, organization: { id: org.id, name: org.name } };
    });
    app.post("/v1/auth/login", async (req, reply) => {
        const body = credentialsSchema.parse(req.body);
        const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
        // Same error whether the email doesn't exist or the password is wrong —
        // distinguishing the two tells an attacker which emails have accounts.
        if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
            throw errors.invalidCredentials();
        }
        const token = createSession({ userId: user.id, orgId: user.orgId });
        reply.setCookie(SESSION_COOKIE, token, cookieOpts);
        return { object: "user", id: user.id, email: user.email };
    });
    app.post("/v1/auth/logout", async (_req, reply) => {
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return { object: "logout", success: true };
    });
    app.get("/v1/auth/me", { preHandler: requireSession }, async (req) => {
        const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
        if (!user)
            throw errors.unauthenticated();
        const org = await prisma.organization.findUnique({ where: { id: user.orgId } });
        return {
            object: "user",
            id: user.id,
            email: user.email,
            organization: org ? { id: org.id, name: org.name, environment: org.env } : null,
        };
    });
}
