import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import type { AssessmentQuestion } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, '../questions.db');

// Ensure database directory exists if we eventually move it
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Define the table schema
const initSql = `
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    question TEXT NOT NULL,
    context TEXT NOT NULL,
    referenceAnswer TEXT NOT NULL
  )
`;

db.exec(initSql);

/**
 * Inserts a new generated question into the database.
 */
export function insertQuestion(q: AssessmentQuestion, topic: string) {
    const stmt = db.prepare(`
    INSERT INTO questions (id, topic, question, context, referenceAnswer)
    VALUES (@id, @topic, @question, @context, @referenceAnswer)
    ON CONFLICT(id) DO UPDATE SET
      topic = excluded.topic,
      question = excluded.question,
      context = excluded.context,
      referenceAnswer = excluded.referenceAnswer
  `);
    stmt.run({ ...q, topic });
}

/**
 * Retrieves a random question from the database.
 * Optional: filter by topic.
 */
export function getRandomQuestion(topic?: string): AssessmentQuestion | null {
    let row;
    if (topic) {
        const stmt = db.prepare('SELECT * FROM questions WHERE topic LIKE ? ORDER BY RANDOM() LIMIT 1');
        row = stmt.get(`%${topic}%`);
    } else {
        const stmt = db.prepare('SELECT * FROM questions ORDER BY RANDOM() LIMIT 1');
        row = stmt.get();
    }

    if (!row) return null;

    return row as AssessmentQuestion;
}

/**
 * Gets the total count of questions in the database.
 */
export function getQuestionCount(): number {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM questions');
    const result = stmt.get() as { count: number };
    return result.count;
}
