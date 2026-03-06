import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomUUID } from "crypto";
import { z } from "zod";
import { AssessmentQuestionSchema } from "./types.js";
import { GCPKnowledgeService } from "./service.js";
import { getRandomQuestion } from "./db.js";

const PORT = Number(process.env["PORT"] ?? 3000);

// ---------------------------------------------------------------------------
// Zod schemas — single source of truth for request shape + validation
// ---------------------------------------------------------------------------

const GenerateRequestSchema = z.object({
    topic: z
        .string()
        .max(200, "Topic must be 200 characters or less.")
        .optional(),
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
    lastUsed: number;
}

const sessions = new Map<string, Session>();

/** Returns the agent for a session, refreshing its TTL, or null if not found. */
function getSession(sessionId: string): GCPKnowledgeService | null {
    const session = sessions.get(sessionId);
    if (!session) return null;
    session.lastUsed = Date.now();
    return session.agent;
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

const app = new Hono();

app.use(cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// POST /api/generate — create a session and stream progress + question via SSE
app.post("/api/generate", async (c) => {
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

    // Topic is parsed for validation but not used for DB filtering.

    return streamSSE(c, async (stream) => {
        const emit = (event: object) => stream.writeSSE({ data: JSON.stringify(event) });

        try {
            console.log(`\n[API] Fetching pre-generated scenario...`);

            await emit({ type: "progress", step: "Fetching pre-generated question..." });

            const question = getRandomQuestion() || getRandomQuestion(); // Random fallback
            if (!question) {
                throw new Error("No questions found in database. Please run npm run seed first.");
            }

            // Question fetched successfully — now register the session for evaluation
            const tempAgent = new GCPKnowledgeService();
            const sessionId = randomUUID();
            sessions.set(sessionId, { agent: tempAgent, lastUsed: Date.now() });
            console.log(`[Session] Created: ${sessionId} (active sessions: ${sessions.size})`);

            await emit({ type: "result", data: { success: true, sessionId, question } });
        } catch (error: unknown) {
            console.error("Error generating question:", error);
            await emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    });
});

// POST /api/evaluate — stream progress + evaluation result via SSE
app.post("/api/evaluate", async (c) => {
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

    const agent = getSession(sessionId);
    if (!agent) {
        return c.json(
            { success: false, error: "Session not found or expired. Please generate a new question." },
            404
        );
    }

    return streamSSE(c, async (stream) => {
        const emit = (event: object) => stream.writeSSE({ data: JSON.stringify(event) });

        try {
            const result = await agent.evaluateAnswer(
                question,
                userAnswer,
                (step) => emit({ type: "progress", step })
            );
            await emit({ type: "result", data: { success: true, result } });
        } catch (error: unknown) {
            console.error("Error evaluating answer:", error);
            await emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    });
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
