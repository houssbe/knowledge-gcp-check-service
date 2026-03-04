import { CEAssessmentAgent } from '../src/agent.js';
import { db, insertQuestion } from '../src/db.js';

const SALES_PLAYS = [
    "Generative AI for Customer Service (e.g., Agents, Dialogflow integration)",
    "Enterprise Search & RAG (e.g., Vertex AI Search)",
    "Employee Productivity (e.g., internal knowledge assistants)",
    "Code Generation & Developer Productivity",
    "MLOps & Predictive AI Models"
];

const QUESTIONS_PER_PLAY = 2; // Generating 2 questions per play for the batch

async function seed() {
    console.log("=== Starting Batch Question Generation ===");
    console.log(`Targeting ${SALES_PLAYS.length} Vertex AI Sales Plays, ${QUESTIONS_PER_PLAY} questions each.`);

    const agent = new CEAssessmentAgent();

    for (const play of SALES_PLAYS) {
        console.log(`\n\n--- Generating for Sales Play: ${play} ---`);
        for (let i = 1; i <= QUESTIONS_PER_PLAY; i++) {
            console.log(`\n[${i}/${QUESTIONS_PER_PLAY}] Generating question...`);
            try {
                const question = await agent.generateQuestion(play, async (step) => {
                    console.log(`  -> Agent: ${step}`);
                });

                insertQuestion(question, play);
                console.log(`  ✅ Successfully saved question: ${question.id}`);
                console.log(`     Topic: ${play}`);
                console.log(`     Question length: ${question.question.length} chars`);
            } catch (error) {
                console.error(`  ❌ Failed to generate question for play "${play}":`);
                console.error(error);
            }
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
