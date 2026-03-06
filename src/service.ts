import { GoogleGenAI, Type } from "@google/genai";
import type { Schema } from "@google/genai";
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

/** JSON schema for batch question generation (array of questions) */
const QUESTION_ARRAY_SCHEMA: Schema = {
    type: Type.ARRAY,
    items: {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.STRING },
            question: { type: Type.STRING },
            context: { type: Type.STRING },
            referenceAnswer: { type: Type.STRING },
            citations: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["id", "question", "context", "referenceAnswer"]
    }
};

export class GCPKnowledgeService {
    private genai: GoogleGenAI;
    private modelName: string;
    private auth: GoogleAuth;
    /** Eagerly initialised auth client — avoids 401 on the first callMCP call. */
    private authReady: Promise<void>;
    /** In-memory cache for fetched documents to avoid redundant MCP calls. */
    private docCache = new Map<string, string>();

    constructor(config: AgentConfig = getConfig()) {
        this.modelName = config.modelName ?? "gemini-3.1-flash-lite-preview";

        if (config.projectId) {
            this.genai = new GoogleGenAI({
                vertexai: true,
                project: config.projectId,
                location: config.location ?? 'global'
            });
        } else if (config.apiKey) {
            this.genai = new GoogleGenAI({ apiKey: config.apiKey });
        } else {
            this.genai = new GoogleGenAI({});
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

        const config = getConfig();
        const authHeaders: Record<string, string> = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
        // The Developer Knowledge API requires a quota project header
        if (config.projectId) {
            authHeaders['x-goog-user-project'] = config.projectId;
        }

        const res = await fetch(MCP_SERVER_URL, {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: Date.now(),
                method,
                params
            }),
            signal: AbortSignal.timeout(60_000) // 60s timeout to prevent indefinite hangs
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
     * Phase 1: Runs an open-ended agentic loop where the agent can call MCP tools freely.
     * Supports two pre-fetch modes:
     *   - prefetchQuery: searches docs via search_documents, then fetches top result (used for question generation)
     *   - prefetchDocNames: directly fetches known documents via batch_get_documents (used for evaluation with existing citations)
     * If pre-fetch succeeds, the agent receives an empty tools array (redundant calls skipped).
     */
    private async runResearchPhase(
        systemInstruction: string,
        prompt: string,
        schema: Schema,
        options?: {
            prefetchQuery?: string | undefined;
            prefetchDocNames?: string[] | undefined;
            onProgress?: ((step: string) => Promise<void>) | undefined;
        }
    ): Promise<{ text: string; sourcesUsed: string[] }> {
        const sourcesUsed: string[] = [];
        const onProgress = options?.onProgress;

        let enrichedPrompt = prompt;
        let prefetchSucceeded = false;

        // === MODE A: Direct document fetch using known citation names (evaluation) ===
        if (options?.prefetchDocNames && options.prefetchDocNames.length > 0) {
            await onProgress?.("Fetching cited documentation...");
            const uncachedNames = options.prefetchDocNames.filter(n => !this.docCache.has(n));
            const cachedNames = options.prefetchDocNames.filter(n => this.docCache.has(n));
            console.log(`\n[Pre-fetch] 📄 Citations: ${cachedNames.length} cached, ${uncachedNames.length} to fetch`);
            try {
                // Fetch only uncached documents
                if (uncachedNames.length > 0) {
                    const docResult = await this.callMCP("tools/call", { name: "batch_get_documents", arguments: { names: uncachedNames } });
                    const docsArray: Array<{ content?: string; name?: string; uri?: string }> = docResult.content?.[0]?.text
                        ? JSON.parse(docResult.content[0].text).documents
                        : (docResult.documents ?? []);
                    for (const doc of docsArray) {
                        const docName = doc.name ?? "unknown";
                        const content = doc.content ?? "";
                        this.docCache.set(docName, content);
                        console.log(`[Pre-fetch] ✅ Fetched & cached: ${docName} (${content.length} chars)`);
                    }
                }

                // Assemble all docs from cache
                const docTexts: string[] = [];
                for (const name of options.prefetchDocNames) {
                    const cached = this.docCache.get(name);
                    if (cached) {
                        sourcesUsed.push(name);
                        docTexts.push(cached);
                    }
                }

                const fullDocText = docTexts.join("\n\n---\n\n");
                enrichedPrompt = `=== OFFICIAL DOCUMENTATION (fetched live from Developer Knowledge API) ===
[Cited Documents]: ${options.prefetchDocNames.join(", ")}
${fullDocText}
=== END OF DOCUMENTATION ===

${prompt}

IMPORTANT: Base your response exclusively on the documentation above. Do NOT use your training data.`;

                prefetchSucceeded = true;
            } catch (err) {
                console.warn(`[Pre-fetch] ⚠️ Direct doc fetch failed:`, err);
            }
        }

        // === MODE B: Search-based fetch using snippets only (question generation) ===
        // Skips the slow batch_get_documents deep fetch — search snippets are enough for question generation.
        if (!prefetchSucceeded && options?.prefetchQuery) {
            await onProgress?.("Fetching documentation...");
            console.log(`\n[Pre-fetch] 🔎 Searching documentation for: "${options.prefetchQuery}"`);
            try {
                const searchResult = await this.callMCP("tools/call", { name: "search_documents", arguments: { query: options.prefetchQuery } });
                sourcesUsed.push(`Searched query: "${options.prefetchQuery}"`);

                // The MCP response wraps chunks in content[0].text as a JSON string
                const rawText = searchResult.content?.[0]?.text;
                const parsed = rawText ? JSON.parse(rawText) : searchResult;
                const chunks: Array<{ parent?: string;[key: string]: any }> = Array.isArray(parsed) ? parsed : (parsed.results ?? parsed.chunks ?? []);

                // Collect ALL unique parent document names — these become the question's
                // citations and will be used later by Mode A (batch_get_documents) during evaluation.
                const parentNames = [...new Set(chunks.map(c => c.parent).filter(Boolean))] as string[];
                sourcesUsed.push(...parentNames);

                // Use search snippets directly — no deep fetch needed for question generation
                const snippetText = chunks.map((c) => (c['content'] ?? c['text'] ?? "")).filter(Boolean).join("\n\n");
                console.log(`[Pre-fetch] ✅ Using ${chunks.length} search snippets (${snippetText.length} chars), ${parentNames.length} parent doc(s) for citations`);

                const citationList = parentNames.length > 0 ? parentNames.join(", ") : "N/A";
                enrichedPrompt = `=== OFFICIAL DOCUMENTATION (fetched live from Developer Knowledge API) ===
[Document Sources]: ${citationList}
${snippetText}
=== END OF DOCUMENTATION ===

${prompt}

IMPORTANT: Base your response exclusively on the documentation above. For the "citations" field, use these document resource names: ${citationList}`;

                prefetchSucceeded = true;

            } catch (err) {
                console.warn(`[Pre-fetch] ⚠️ Pre-fetch failed, agent will rely on tools:`, err);
            }
        }

    // If pre-fetch succeeded, the full doc is in the prompt.
    if (!prefetchSucceeded) {
        console.warn(`[Research] Pre-fetch failed or was skipped. Model will use training data.`);
    }

        await onProgress?.("Generating...");

        // Direct Gemini API call — no ADK overhead (no sessions, no event streams)
        const response = await this.genai.models.generateContent({
            model: this.modelName,
            contents: enrichedPrompt,
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: schema
            }
        });

        const finalText = response.text ?? "";
        if (!finalText) throw new Error("Model produced no response.");
        console.log(`[Gemini] ✅ Response received (${finalText.length} chars)`);
        return { text: finalText, sourcesUsed };
    }



    /**
     * Searches the MCP Developer Knowledge API and returns raw snippets.
     * Use this to pre-fetch documentation before calling generateQuestions.
     */
    async searchSnippets(query: string): Promise<{ snippets: string; parentNames: string[] }> {
        console.log(`\n[Pre-fetch] 🔎 Searching: "${query}"`);
        const searchResult = await this.callMCP("tools/call", { name: "search_documents", arguments: { query } });
        // The MCP response wraps chunks in content[0].text as a JSON string
        const rawText = searchResult.content?.[0]?.text;
        const parsed = rawText ? JSON.parse(rawText) : searchResult;
        const chunks: Array<{ parent?: string;[key: string]: any }> = Array.isArray(parsed) ? parsed : (parsed.results ?? parsed.chunks ?? []);
        const parentNames = [...new Set(chunks.map(c => c.parent).filter(Boolean))] as string[];
        const snippets = chunks.map(c => c['content'] ?? c['text'] ?? "").filter(Boolean).join("\n\n");
        console.log(`[Pre-fetch] ✅ ${chunks.length} snippets (${snippets.length} chars), ${parentNames.length} parent doc(s)`);
        return { snippets, parentNames };
    }

    /**
     * Generates multiple assessment questions in a single LLM call.
     * Accepts pre-fetched snippets to avoid MCP calls during generation.
     */
    async generateQuestions(
        topic: string,
        count: number,
        prefetched?: { snippets: string; parentNames: string[] },
        onProgress?: (step: string) => Promise<void>
    ): Promise<AssessmentQuestion[]> {
        await onProgress?.(`Generating ${count} question(s) for "${topic}"...`);

        let prompt = buildQuestionGenerationPrompt(topic);

        // Inject pre-fetched snippets if available
        if (prefetched && prefetched.snippets.length > 0) {
            const citationList = prefetched.parentNames.join(", ") || "N/A";
            prompt = `=== OFFICIAL DOCUMENTATION (fetched live from Developer Knowledge API) ===
[Document Sources]: ${citationList}
${prefetched.snippets}
=== END OF DOCUMENTATION ===

${prompt}

IMPORTANT: Generate exactly ${count} DIFFERENT questions. Each question MUST be specifically about "${topic}" — do NOT generate questions about other Google Cloud products even if they appear in the documentation. Base them exclusively on the documentation above. For the "citations" field, use these document resource names: ${citationList}`;
        } else {
            prompt += `\n\nGenerate exactly ${count} DIFFERENT questions.`;
        }

        const response = await this.genai.models.generateContent({
            model: this.modelName,
            contents: prompt,
            config: {
                systemInstruction: QUESTION_GENERATION_SYSTEM_PROMPT,
                responseMimeType: "application/json",
                responseSchema: QUESTION_ARRAY_SCHEMA
            }
        });

        const text = response.text ?? "";
        if (!text) throw new Error("Model produced no response.");

        try {
            const cleaned = text.replace(/```json\n?|```/g, "").trim();
            const raw = JSON.parse(cleaned);
            const questions = (Array.isArray(raw) ? raw : [raw]).map(q => {
                // Override LLM-generated citations with actual parent document names
                // from the search results — these are in the correct `documents/...` format
                // that batch_get_documents requires.
                if (prefetched?.parentNames?.length) {
                    q.citations = prefetched.parentNames;
                }
                return AssessmentQuestionSchema.parse(q);
            });
            console.log(`[Gemini] ✅ Generated ${questions.length} question(s) for "${topic}"`);
            return questions;
        } catch (err) {
            console.error("Failed to parse batch question JSON:", text);
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`Invalid question format generated: ${detail}`);
        }
    }

    /**
     * Generates a single assessment question (convenience wrapper).
     */
    async generateQuestion(topic: string = "Vertex AI core capabilities", onProgress?: (step: string) => Promise<void>): Promise<AssessmentQuestion> {
        const questions = await this.generateQuestions(topic, 1, undefined, onProgress);
        if (!questions.length) throw new Error("No questions generated.");
        return questions[0]!;
    }

    /**
     * Evaluates the user's answer against the generated question using ground truth documentation.
     */
    async evaluateAnswer(question: AssessmentQuestion, userAnswer: string, onProgress?: (step: string) => Promise<void>): Promise<AssessmentResult> {
        // Step 1: If the question has citations, fetch those docs directly.
        //         Otherwise fall back to a search query.
        const hasCitations = question.citations && question.citations.length > 0;
        const research = await this.runResearchPhase(
            EVALUATION_SYSTEM_PROMPT,
            buildEvaluationPrompt(
                question.context ?? "N/A",
                question.question,
                question.referenceAnswer ?? "",
                userAnswer
            ),
            EVALUATION_SCHEMA,
            {
                prefetchDocNames: hasCitations ? question.citations : undefined,
                prefetchQuery: hasCitations ? undefined : question.question.split(/\s+/).slice(0, 10).join(" "),
                onProgress
            }
        );

        try {
            const cleaned = research.text.replace(/```json\n?|```/g, "").trim();
            // Zod validates the raw model output shape before we enrich it.
            // This prevents isCorrect being a string like "true", or feedback being absent.
            const raw = EvaluationOutputSchema.parse(JSON.parse(cleaned));
            return {
                questionId: question.id,
                isCorrect: raw.isCorrect,
                reasoning: raw.reasoning,
                feedback: raw.feedback,
                sourcesUsed: research.sourcesUsed,
                citations: raw.citations
            } satisfies AssessmentResult;
        } catch (err) {
            console.error("Failed to parse/validate evaluation JSON:", research.text);
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`Invalid evaluation format generated: ${detail}`);
        }
    }
}
