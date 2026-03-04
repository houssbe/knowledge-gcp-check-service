import { CEAssessmentAgent } from "./agent.js";
import { getRandomQuestion } from "./db.js";
import * as readline from "readline";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

async function run() {
    console.log("=== Vertex AI CE Interactive Skills Assessment ===");
    console.log("Connecting to Developer Knowledge Agent...");

    const agent = new CEAssessmentAgent();

    try {
        console.log("\n[System]: Fetching a pre-generated Vertex AI scenario question...");
        const question = getRandomQuestion();
        if (!question) {
            throw new Error("No questions found in database. Please run npm run seed first.");
        }

        console.log("\n--------------------------------------------------");
        console.log(`SCENARIO CONTEXT:\n${question.context}`);
        console.log(`\nQUESTION:\n${question.question}`);
        console.log("--------------------------------------------------\n");

        const answer = await askQuestion("Your Answer: ");
        console.log("\n[System]: Evaluating your answer against Developer Knowledge...");

        const result = await agent.evaluateAnswer(question, answer);

        console.log("\n=== ASSESSMENT RESULT ===");
        console.log(`Result: ${result.isCorrect ? "✅ SUCCESS" : "❌ NEEDS IMPROVEMENT"}`);
        console.log(`\nFeedback:\n${result.feedback}`);

        console.log(`\n(Reference Answer context: ${question.referenceAnswer})`);

    } catch (error) {
        console.error("\nFailed to run assessment agent:", error);
    } finally {
        rl.close();
    }
}

// Execute the main function
run();
