import { Type } from "@google/genai";
import type { Schema } from "@google/genai";
import { Gemini, LlmAgent, InMemoryRunner, stringifyContent, FunctionTool } from "@google/adk";
import { GoogleAuth } from "google-auth-library";
import type { AssessmentQuestion, AssessmentResult } from "./types.js";
import { AssessmentQuestionSchema, EvaluationOutputSchema } from "./types.js";
import { type AgentConfig, getConfig } from "./config.js";
import {
    QUESTION_GENERATION_SYSTEM_PROMPT,
    buildQuestionGenerationPrompt,
    EVALUATION_SYSTEM_PROMPT,
    buildEvaluationPrompt
} from "./prompts.js";

const MCP_SERVER_URL = "https://developerknowledge.googleapis.com/mcp";

/** JSON schema for the generated question response */
const QUESTION_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        id: { type: Type.STRING },
        question: { type: Type.STRING },
        context: { type: Type.STRING },
        referenceAnswer: { type: Type.STRING }
    },
    required: ["id", "question", "context", "referenceAnswer"]
};

/** JSON schema for the evaluation response */
const EVALUATION_SCHEMA: Schema = {
    type: Type.OBJECT,
    properties: {
        reasoning: { type: Type.STRING },
        isCorrect: { type: Type.BOOLEAN },
        feedback: { type: Type.STRING }
    },
    required: ["reasoning", "isCorrect", "feedback"]
};

export class CEAssessmentAgent {
    private adkModel: Gemini;
    private auth: GoogleAuth;
    /** Eagerly initialised auth client — avoids 401 on the first callMCP call. */
    private authReady: Promise<void>;

    constructor(config: AgentConfig = getConfig()) {
        const modelName = config.modelName ?? "gemini-3-flash-preview";

        if (config.projectId) {
            this.adkModel = new Gemini({
                model: modelName,
                vertexai: true,
                project: config.projectId,
                location: config.location ?? 'global'
            });
        } else if (config.apiKey) {
            this.adkModel = new Gemini({
                model: modelName,
                apiKey: config.apiKey
            });
        } else {
            this.adkModel = new Gemini({ model: modelName });
        }

        this.auth = new GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });

        // Warm up the auth client eagerly by fetching the access token directly.
        this.authReady = this.auth.getAccessToken().then(() => {
            console.log(`[Auth] ✅ GoogleAuth access token acquired.`);
        }).catch((err) => {
            console.error('[Auth] ❌ GoogleAuth token fetch failed:', err);
        });
    }

    /**
     * Helper to make stateless POST JSON-RPC requests to the Developer Knowledge MCP Server.
     * The server only supports stateless HTTP POST requests, not standard SSE.
     */
    private async callMCP(method: string, params: any): Promise<any> {
        console.log(`\n[MCP] ---> Sending request to Developer Knowledge Server`);
        console.log(`[MCP] Method: ${method}, Params:`, JSON.stringify(params));

        // Ensure the token has been successfully fetched at least once
        await this.authReady;
        const token = await this.auth.getAccessToken();

        const authHeaders = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        const res = await fetch(MCP_SERVER_URL, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: Date.now(),
                method,
                params
            })
        });

        if (!res.ok) {
            throw new Error(`MCP API Error: ${res.status} ${await res.text()}`);
        }

        const data = await res.json() as any;
        if (data.error) {
            console.error(`[MCP] <--- Error from server:`, data.error.message);
            throw new Error(`MCP RPC Error: ${data.error.message}`);
        }

        console.log(`[MCP] <--- Received response successfully (Length: ${JSON.stringify(data.result).length} chars)`);
        return data.result;
    }


    /**
     * Builds ADK FunctionTools to query the Developer Knowledge MCP server.
     * search_documents automatically fetches the full content of the top result,
     * so the agent always has deep document context without needing to decide to
     * call get_document separately.
     */
    private buildToolsFromMCP(sourcesUsed: string[]): FunctionTool[] {
        const searchTool = new FunctionTool({
            name: "search_documents",
            description: "Search Google developer products documentation. Returns snippets AND automatically fetches the full content of the most relevant document.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    query: { type: Type.STRING, description: "The search query (e.g. 'How to create a Cloud Storage bucket?')" }
                },
                required: ["query"]
            },
            fn: async ({ query }: { query: string }) => {
                console.log(`\nTool called: search_documents("${query}")`);
                sourcesUsed.push(`Searched query: "${query}"`);
                const searchResult = await this.callMCP("tools/call", { name: "search_documents", arguments: { query } });

                // === DIAGNOSTIC: log the raw MCP response structure ===
                console.log(`\n[search_documents] 🔬 RAW response (first 2 items):`);
                const rawContent = searchResult.content ?? [];
                const sampleItems = Array.isArray(rawContent) ? rawContent.slice(0, 2) : [rawContent];
                for (const item of sampleItems) {
                    console.log(JSON.stringify(item, null, 2));
                }
                // ======================================================

                // Auto-fetch the top document to guarantee full context.
                const chunks: Array<{ parent?: string;[key: string]: any }> = rawContent;
                const topParent = chunks.find((c) => c.parent)?.parent;
                console.log(`\n[search_documents] Extracted topParent: ${topParent ?? "⚠️ NOT FOUND — no 'parent' field in chunks"}`);

                if (topParent) {
                    console.log(`\n[search_documents] 🔍 Auto-fetching top document: "${topParent}"`);
                    sourcesUsed.push(`Read document: "${topParent}"`);
                    try {
                        const docResult = await this.callMCP("tools/call", { name: "get_document", arguments: { name: topParent } });
                        const docChunks: Array<{ text?: string }> = docResult.content ?? [];
                        const docText = docChunks.map((c) => c.text ?? "").join("\n\n");
                        return JSON.stringify({
                            search_snippets: searchResult.content,
                            full_document: { name: topParent, content: docText }
                        });
                    } catch (err) {
                        console.warn(`[search_documents] ⚠️ Could not auto-fetch "${topParent}":`, err);
                    }
                }

                return JSON.stringify(searchResult.content);
            }
        } as any);

        const getDocTool = new FunctionTool({
            name: "get_document",
            description: "Retrieve the full content of a single document by its resource name (from the 'parent' field of search_documents results).",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    name: { type: Type.STRING, description: "The resource name of the document." }
                },
                required: ["name"]
            },
            fn: async ({ name }: { name: string }) => {
                console.log(`\nTool called: get_document("${name}")`);
                sourcesUsed.push(`Read document: "${name}"`);
                const result = await this.callMCP("tools/call", { name: "get_document", arguments: { name } });
                return JSON.stringify(result.content);
            }
        } as any);

        return [searchTool, getDocTool];
    }

    /**
     * Phase 1: Runs an open-ended agentic loop where the agent can call MCP tools freely.
     * When prefetchQuery is provided, documentation is fetched BEFORE invoking the agent
     * and injected directly into the prompt — guaranteeing MCP is always consulted.
     * If pre-fetch succeeds, the agent receives an empty tools array (redundant calls skipped).
     */
    private async runResearchPhase(
        systemInstruction: string,
        prompt: string,
        prefetchQuery?: string,
        onProgress?: (step: string) => Promise<void>
    ): Promise<{ text: string; sourcesUsed: string[] }> {
        const sourcesUsed: string[] = [];

        let enrichedPrompt = prompt;
        let prefetchSucceeded = false;

        // Pre-fetch documentation deterministically in Node.js code so the model
        // cannot skip it. This is more reliable than relying on the model to call tools.
        if (prefetchQuery) {
            await onProgress?.("Fetching documentation...");
            console.log(`\n[Pre-fetch] 🔎 Searching documentation for: "${prefetchQuery}"`);
            try {
                const searchResult = await this.callMCP("tools/call", { name: "search_documents", arguments: { query: prefetchQuery } });
                sourcesUsed.push(`Searched query: "${prefetchQuery}"`);

                // === DIAGNOSTIC: log raw structure ===
                const rawContent = searchResult.content ?? [];
                console.log(`\n[Pre-fetch] 🔬 RAW response (first 2 items):`);
                const sample = Array.isArray(rawContent) ? rawContent.slice(0, 2) : [rawContent];
                for (const item of sample) console.log(JSON.stringify(item, null, 2));
                // =====================================

                const chunks: Array<{ parent?: string;[key: string]: any }> = Array.isArray(rawContent) ? rawContent : [];
                const topParent = chunks.find((c) => c.parent)?.parent;
                console.log(`\n[Pre-fetch] Extracted topParent: ${topParent ?? "⚠️ NOT FOUND — no 'parent' field"}`);

                let fullDocText = "";
                if (topParent) {
                    console.log(`\n[Pre-fetch] 📄 Fetching full document: "${topParent}"`);
                    sourcesUsed.push(`Read document: "${topParent}"`);
                    const docResult = await this.callMCP("tools/call", { name: "get_document", arguments: { name: topParent } });
                    const docChunks: Array<{ text?: string }> = docResult.content ?? [];
                    fullDocText = docChunks.map((c) => c.text ?? "").join("\n\n");
                    console.log(`[Pre-fetch] ✅ Document fetched (${fullDocText.length} chars)`);
                }

                // Inject the fetched documentation at the top of the prompt
                const snippetText = chunks.map((c) => (c['text'] ?? "")).filter(Boolean).join("\n\n");
                enrichedPrompt = `=== OFFICIAL DOCUMENTATION (fetched live from Developer Knowledge API) ===
${fullDocText || snippetText}
=== END OF DOCUMENTATION ===

${prompt}

IMPORTANT: Base your response exclusively on the documentation above. Do NOT use your training data.`;

                prefetchSucceeded = true;

            } catch (err) {
                console.warn(`[Pre-fetch] ⚠️ Pre-fetch failed, agent will rely on tools:`, err);
            }
        }

        // If pre-fetch succeeded, the full doc is in the prompt — agent tools are redundant.
        // Only provide tools if the pre-fetch was skipped or failed so the agent can self-fetch.
        const tools = prefetchSucceeded ? [] : this.buildToolsFromMCP(sourcesUsed);
        if (prefetchSucceeded) {
            console.log(`[Research] Pre-fetch succeeded — running agent without tools (redundant MCP calls skipped).`);
        }

        await onProgress?.("Agent researching...");

        const agent = new LlmAgent({
            name: "research_agent",
            model: this.adkModel,
            instruction: systemInstruction,
            tools
        });

        const runner = new InMemoryRunner({ agent });
        const sessionId = `session-${Date.now()}`;
        await runner.sessionService.createSession({
            appName: runner.appName,
            userId: "local-user",
            sessionId,
        });

        const events = runner.runAsync({
            userId: "local-user",
            sessionId,
            newMessage: { role: "user", parts: [{ text: enrichedPrompt }] }
        });

        let finalText = "";
        for await (const event of events) {
            if (event.content && event.author === agent.name) {
                finalText = stringifyContent(event); // = not += (last event only)

                // Log what the agent is doing inside its event stream
                const parts = event.content.parts || [];
                for (const part of parts) {
                    if (part.functionCall) {
                        console.log(`[Agent: ${agent.name}] 🛠️ Decided to call tool: ${part.functionCall.name}`);
                    } else if (part.text && !part.text.includes("```json")) {
                        console.log(`[Agent: ${agent.name}] 🧠 Thought: ${part.text.substring(0, 100).replace(/\n/g, " ")}...`);
                    }
                }
            } else if (event.content?.parts?.some((p: any) => p.functionResponse)) {
                console.log(`[Agent: ${agent.name}] 📥 Received tool execution results.`);
            } else if (event.errorMessage) {
                console.error(`[Agent: ${agent.name}] ❌ ADK error:`, event.errorMessage);
            }
        }

        if (!finalText) throw new Error("Agent produced no response.");
        return { text: finalText, sourcesUsed };
    }

    /**
     * Phase 2: Runs a structured extraction pass with outputSchema to parse the
     * research output into a strict typed JSON shape.
     * NOTE: outputSchema disables tool use by design — this is a pure extraction step.
     */
    private async runExtractionPhase(
        researchOutput: string,
        schema: Schema
    ): Promise<string> {
        const agent = new LlmAgent({
            name: "extraction_agent",
            model: this.adkModel,
            instruction: "Extract and return the structured JSON from the research output below. Do not add any explanation.",
            outputSchema: schema,  // ✅ No tools — outputSchema is valid here
            disallowTransferToParent: true,
            disallowTransferToPeers: true
        });

        const runner = new InMemoryRunner({ agent });
        const sessionId = `session-${Date.now()}`;
        await runner.sessionService.createSession({
            appName: runner.appName,
            userId: "local-user",
            sessionId,
        });

        const events = runner.runAsync({
            userId: "local-user",
            sessionId,
            newMessage: { role: "user", parts: [{ text: researchOutput }] }
        });

        let finalText = "";
        for await (const event of events) {
            if (event.content && event.author === agent.name) {
                finalText = stringifyContent(event);
            }
        }
        if (!finalText) throw new Error("Extraction agent produced no output.");
        return finalText;
    }

    /**
     * Generates a CE assessment question based on a given topic.
     */
    async generateQuestion(topic: string = "Vertex AI core capabilities", onProgress?: (step: string) => Promise<void>): Promise<AssessmentQuestion> {
        // Step 1: Research using MCP tools — pre-fetch docs to guarantee MCP is consulted
        const research = await this.runResearchPhase(
            QUESTION_GENERATION_SYSTEM_PROMPT,
            buildQuestionGenerationPrompt(topic),
            topic,  // prefetchQuery: fetch documentation before running the agent
            onProgress
        );

        // Step 2: Extract structured JSON from research output
        await onProgress?.("Structuring response...");
        const structured = await this.runExtractionPhase(research.text, QUESTION_SCHEMA);

        try {
            const cleaned = structured.replace(/```json\n?|```/g, "").trim();
            // Zod validates every field — catches hallucinated types, missing fields,
            // and empty strings that JSON.parse alone would silently accept.
            return AssessmentQuestionSchema.parse(JSON.parse(cleaned));
        } catch (err) {
            console.error("Failed to parse/validate question JSON:", structured);
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`Invalid question format generated: ${detail}`);
        }
    }

    /**
     * Evaluates the user's answer against the generated question using ground truth documentation.
     */
    async evaluateAnswer(question: AssessmentQuestion, userAnswer: string, onProgress?: (step: string) => Promise<void>): Promise<AssessmentResult> {
        // Step 1: Research + evaluate using MCP tools — pre-fetch docs to guarantee MCP is consulted
        const prefetchQuery = `${question.question} Vertex AI`.trim();
        const research = await this.runResearchPhase(
            EVALUATION_SYSTEM_PROMPT,
            buildEvaluationPrompt(
                question.context ?? "N/A",
                question.question,
                question.referenceAnswer ?? "",
                userAnswer
            ),
            prefetchQuery,  // prefetchQuery: fetch documentation before running the agent
            onProgress
        );

        // Step 2: Extract structured evaluation JSON
        await onProgress?.("Structuring response...");
        const structured = await this.runExtractionPhase(research.text, EVALUATION_SCHEMA);

        try {
            const cleaned = structured.replace(/```json\n?|```/g, "").trim();
            // Zod validates the raw model output shape before we enrich it.
            // This prevents isCorrect being a string like "true", or feedback being absent.
            const raw = EvaluationOutputSchema.parse(JSON.parse(cleaned));
            return {
                questionId: question.id,
                isCorrect: raw.isCorrect,
                reasoning: raw.reasoning,
                feedback: raw.feedback,
                sourcesUsed: research.sourcesUsed
            } satisfies AssessmentResult;
        } catch (err) {
            console.error("Failed to parse/validate evaluation JSON:", structured);
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`Invalid evaluation format generated: ${detail}`);
        }
    }
}
