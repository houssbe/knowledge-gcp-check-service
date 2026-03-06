import { GCPKnowledgeService } from '../src/service.js';
import { db, insertQuestion } from '../src/db.js';
import { getConfig } from '../src/config.js';

/**
 * A list of Google Cloud products that double as UI topics.
 * These are passed directly to the MCP search.
 */
const PRODUCTS: string[] = [
    "Vertex AI",
    "BigQuery",
    "AlloyDB",
    "Cloud SQL",
    "Spanner",
    "GKE",
    "Cloud Run"
];

const config = getConfig();
const QUESTIONS_PER_PRODUCT = config.questionsPerPlay ?? 2;

async function seed() {
    console.log("=== Starting Batch Question Generation ===");
    console.log(`${PRODUCTS.length} products, ${QUESTIONS_PER_PRODUCT} question(s) each.\n`);

    const agent = new GCPKnowledgeService();

    // ── Phase 1: Parallel MCP Pre-fetch ───────────────────────────────
    console.log("── Phase 1: Parallel MCP pre-fetch ──");
    const snippetMap = new Map<string, { snippets: string; parentNames: string[] }>();

    const fetchResults = await Promise.allSettled(
        PRODUCTS.map(async (product) => {
            if (snippetMap.has(product)) return; // dedup
            const result = await agent.searchSnippets(product);
            snippetMap.set(product, result);
        })
    );

    const fetchOk = fetchResults.filter(r => r.status === "fulfilled").length;
    const fetchFail = fetchResults.filter(r => r.status === "rejected").length;
    console.log(`\n✅ Pre-fetch complete: ${fetchOk} succeeded, ${fetchFail} failed\n`);

    // ── Phase 2: Batch Question Generation (per product) ──────────────
    console.log("── Phase 2: Batch question generation ──");

    for (const product of PRODUCTS) {
        console.log(`\n--- Product: ${product} (${QUESTIONS_PER_PRODUCT} question(s)) ---`);
        try {
            const prefetched = snippetMap.get(product);
            const questions = await agent.generateQuestions(
                product,
                QUESTIONS_PER_PRODUCT,
                prefetched,
                async (step) => console.log(`    -> ${step}`)
            );

            let inserted = 0;
            for (const q of questions) {
                // Skip refused questions
                if (q.question.includes("I cannot generate") || q.question.includes("does not mention")) {
                    console.log(`    [!] Skipping refused question for ${product}`);
                    continue;
                }
                insertQuestion(q, product);
                inserted++;
            }
            console.log(`    ✅ Inserted ${inserted} question(s) into database.`);
        } catch (err) {
            console.error(`    ❌ Failed generating batch for ${product}:`, err);
        }
    }

    const countObj = db.prepare('SELECT COUNT(*) as count FROM questions').get() as { count: number };
    console.log(`\n=== Seeding Complete ===`);
    console.log(`Total questions in database: ${countObj.count}`);
}

seed().catch(err => {
    console.error("Fatal error during seeding:", err);
    process.exit(1);
});
