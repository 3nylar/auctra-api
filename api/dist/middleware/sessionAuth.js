import { errors } from "../lib/errors.js";
import { SESSION_COOKIE, verifySession } from "../lib/session.js";
/**
 * Authenticates a *person* sitting at the dashboard, via a signed cookie —
 * as distinct from `authenticate` in this same folder, which authenticates
 * a *program* via a Bearer API key. The two are intentionally separate
 * middlewares on separate route groups: a stolen API key should never be
 * enough to create or revoke other keys, and a dashboard session should
 * never be accepted as a Bearer token by the auction endpoints.
 */
export async function requireSession(req, _reply) {
    const token = req.cookies?.[SESSION_COOKIE];
    const session = verifySession(token);
    if (!session)
        throw errors.unauthenticated("Not logged in, or your session has expired.");
    req.session = { userId: session.userId, orgId: session.orgId };
}
