import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomUUID } from "crypto";
import { z } from "zod";
import admin from "firebase-admin";

import { AssessmentQuestionSchema } from "./types.js";
import { GCPKnowledgeService } from "./service.js";
import { getRandomQuestion, insertLeaderboardScore, getLeaderboard, getUserName, setUserName } from "./db.js";

// Initialize Firebase Admin (Uses Application Default Credentials in GCP)
admin.initializeApp();


const PORT = Number(process.env["PORT"] ?? 3000);

// ---------------------------------------------------------------------------
// Zod schemas — single source of truth for request shape + validation
// ---------------------------------------------------------------------------

const GenerateRequestSchema = z.object({
    topic: z
        .string()
        .max(200, "Topic must be 200 characters or less.")
        .optional(),
    sessionId: z.string().nullish(),
});

const UserRequestSchema = z.object({
    username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_.-]+$/, "Username can only contain alphanumeric characters, underscores, dashes, or dots.")
});


const EvaluateRequestSchema = z.object({
    sessionId: z.string().min(1, "sessionId is required."),
    question: AssessmentQuestionSchema,
    // .min(1) alone allows whitespace-only strings — .refine() enforces the true rule
    userAnswer: z
        .string()
        .min(1, "userAnswer must be a non-empty string.")
        .refine((s) => s.trim().length > 0, { message: "userAnswer must not be blank or whitespace only." }),
});



// ---------------------------------------------------------------------------
// Session pool — one agent per user, 30-minute idle TTL
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 60 * 1000;

interface Session {
    agent: GCPKnowledgeService;
    userId: string;
    score: number;
    questionCount: number;
    questionStartTime: number;
    lastUsed: number;
}

const sessions = new Map<string, Session>();

/** Returns the session data, refreshing its TTL, or null if not found. */
function getSessionData(sessionId: string): Session | null {
    const session = sessions.get(sessionId);
    if (!session) return null;
    session.lastUsed = Date.now();
    return session;
}


/** Periodically removes idle sessions. .unref() lets the process exit naturally. */
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
        if (now - session.lastUsed > SESSION_TTL_MS) {
            sessions.delete(id);
            console.log(`[Session] Expired: ${id} (active sessions: ${sessions.size})`);
        }
    }
}, SESSION_TTL_MS).unref();

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono<{ Variables: { uid: string } }>();

app.use(cors());

// ---------------------------------------------------------------------------
// Firebase Auth Middleware
// ---------------------------------------------------------------------------
const authMiddleware = async (c: any, next: () => Promise<void>) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ success: false, error: "Missing or invalid Authorization header" }, 401);
    }

    const idToken = authHeader.split(" ")[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        c.set("uid", decodedToken.uid);
        await next();
    } catch (error) {
        console.error("Firebase Auth Error:", error);
        return c.json({ success: false, error: "Unauthorized access or expired token" }, 401);
    }
};

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// GET /api/config — fetch public Firebase configuration for frontend at runtime
app.get("/api/config", (c) => {
    return c.json({
        success: true,
        config: {
            apiKey: process.env["FIREBASE_API_KEY"],
            authDomain: process.env["FIREBASE_AUTH_DOMAIN"] || `${process.env["GCP_PROJECT_ID"]}.firebaseapp.com`,
            projectId: process.env["GCP_PROJECT_ID"]
        }
    });
});


// GET /api/user — fetch the currently authenticated user's profile/username
app.get("/api/user", authMiddleware, async (c) => {
    const uid = c.get("uid");
    try {
        const username = await getUserName(uid);
        if (!username) {
            return c.json({ success: true, user: null });
        }
        return c.json({ success: true, user: { username } });
    } catch (e) {
        console.error("Error fetching user profile:", e);
        return c.json({ success: false, error: "Internal server error" }, 500);
    }
});

// POST /api/user — create or update the authenticated user's username
app.post("/api/user", authMiddleware, async (c) => {
    const uid = c.get("uid");
    let rawBody: unknown;
    try {
        rawBody = await c.req.json();
    } catch {
        return c.json({ success: false, error: "Request body must be valid JSON." }, 400);
    }

    const parsed = UserRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
        return c.json(
            { success: false, error: parsed.error.issues[0]?.message ?? "Invalid username payload." },
            400
        );
    }

    try {
        await setUserName(uid, parsed.data.username);
        return c.json({ success: true, user: { username: parsed.data.username } });
    } catch (e: any) {
        console.error("Error saving username:", e);
        // Postgres unique violation
        if (e.code === '23505') {
            return c.json({ success: false, error: "Username is already taken." }, 409);
        }
        return c.json({ success: false, error: "Internal server error" }, 500);
    }
});

// POST /api/generate — create a session and stream progress + question via SSE
app.post("/api/generate", authMiddleware, async (c) => {
    // Guard against malformed / missing JSON body
    let rawBody: unknown;
    try {
        rawBody = await c.req.json();
    } catch {
        return c.json({ success: false, error: "Request body must be valid JSON." }, 400);
    }

    const parsed = GenerateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
        return c.json(
            { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request body." },
            400
        );
    }

    // Topic is parsed and used for DB filtering.
    const topic = parsed.data.topic;

    return streamSSE(c, async (stream) => {
        const emit = (event: object) => stream.writeSSE({ data: JSON.stringify(event) });

        try {
            console.log(`\n[API] Fetching pre-generated scenario...`);

            await emit({ type: "progress", step: "Fetching pre-generated question..." });

            const question = (await getRandomQuestion(topic)) || (await getRandomQuestion()); // Random fallback
            if (!question) {
                throw new Error("No questions found in database. Please run npm run seed first.");
            }

            let sessionObj = parsed.data.sessionId ? getSessionData(parsed.data.sessionId) : null;
            let sessionId = parsed.data.sessionId;

            if (sessionObj) {
                if (sessionObj.questionCount >= 10) {
                    throw new Error("Game Over. Maximum questions reached for this session.");
                }
                sessionObj.questionStartTime = Date.now();
                sessionObj.questionCount += 1;
            } else {
                const tempAgent = new GCPKnowledgeService();
                sessionId = randomUUID();
                sessionObj = {
                    agent: tempAgent,
                    userId: c.get("uid"), // Secure UID from Auth Middleware
                    score: 0,
                    questionCount: 1,
                    questionStartTime: Date.now(),
                    lastUsed: Date.now()
                };
                sessions.set(sessionId, sessionObj);
                console.log(`[Session] Created: ${sessionId} for User: ${c.get("uid")}`);
            }

            await emit({ type: "result", data: { success: true, sessionId, question, questionCount: sessionObj.questionCount } });
        } catch (error: unknown) {
            console.error("Error generating question:", error);
            await emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    });
});

// POST /api/evaluate — stream progress + evaluation result via SSE
app.post("/api/evaluate", authMiddleware, async (c) => {
    // Guard against malformed / missing JSON body
    let rawBody: unknown;
    try {
        rawBody = await c.req.json();
    } catch {
        return c.json({ success: false, error: "Request body must be valid JSON." }, 400);
    }

    const parsed = EvaluateRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
        return c.json(
            { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request body." },
            400
        );
    }

    const { sessionId, question, userAnswer } = parsed.data;
    console.log(`\n[API] Evaluating answer for question ID: ${question.id} (session: ${sessionId})...`);

    const sessionObj = getSessionData(sessionId);
    if (!sessionObj) {
        return c.json(
            { success: false, error: "Session not found or expired. Please start a new game." },
            404
        );
    }
    const agent = sessionObj.agent;

    return streamSSE(c, async (stream) => {
        const emit = (event: object) => stream.writeSSE({ data: JSON.stringify(event) });

        try {
            const result = await agent.evaluateAnswer(
                question,
                userAnswer,
                (step) => emit({ type: "progress", step })
            );

            // Calculate points
            const timeTakenMs = Date.now() - sessionObj.questionStartTime;
            const timeTakenSec = timeTakenMs / 1000;

            let points = 0;
            if (result.status === "CORRECT") {
                points = 100;
                // speed bonus (up to 50 pts if answer matches under 30s)
                if (timeTakenSec < 30) {
                    points += Math.floor(50 * (30 - timeTakenSec) / 30);
                }
            } else if (result.status === "PARTIAL") {
                points = 50; // no speed bonus for partial
            }

            sessionObj.score += points;

            let isGameOver = false;
            if (sessionObj.questionCount >= 10) {
                isGameOver = true;
                await insertLeaderboardScore(randomUUID(), sessionObj.userId, sessionObj.score);
                console.log(`[Leaderboard] Saved score ${sessionObj.score} for user ${sessionObj.userId}`);
            }

            await emit({
                type: "result", data: {
                    success: true,
                    result,
                    pointsEarned: points,
                    totalScore: sessionObj.score,
                    isGameOver
                }
            });
        } catch (error: unknown) {
            console.error("Error evaluating answer:", error);
            await emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    });
});

app.get("/api/leaderboard", async (c) => {
    try {
        const leaderboard = await getLeaderboard();
        return c.json({ success: true, leaderboard });
    } catch (e: any) {
        console.error("Error fetching leaderboard:", e);
        return c.json({ success: false, error: "Failed to load leaderboard." }, 500);
    }
});

// Serve static frontend files — registered last so API routes always take priority.
// @hono/node-server resolves `root` relative to process.cwd(), so this works
// correctly when the server is started from the project root via `npm run dev`/`npm start`.
app.use("*", serveStatic({ root: "./public" }));

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`\n=== Web Server Started ===`);
    console.log(`🚀 Graphical Interface available at: http://localhost:${PORT}`);
    console.log(`===========================\n`);
});
