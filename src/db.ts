import Database, { type Database as DatabaseType } from 'better-sqlite3';
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

export const db: DatabaseType = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Define the table schema
const initSql = `
  CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    question TEXT NOT NULL,
    context TEXT NOT NULL,
    referenceAnswer TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]'
  )
`;

// Add citations column to existing databases that don't have it yet
try {
    db.exec(`ALTER TABLE questions ADD COLUMN citations TEXT NOT NULL DEFAULT '[]'`);
} catch (_) {
    // Column already exists — safe to ignore
}

db.exec(initSql);

/**
 * Inserts a new generated question into the database.
 */
export function insertQuestion(q: AssessmentQuestion, topic: string) {
    const stmt = db.prepare(`
    INSERT INTO questions (id, topic, question, context, referenceAnswer, citations)
    VALUES (@id, @topic, @question, @context, @referenceAnswer, @citations)
    ON CONFLICT(id) DO UPDATE SET
      topic = excluded.topic,
      question = excluded.question,
      context = excluded.context,
      referenceAnswer = excluded.referenceAnswer,
      citations = excluded.citations
  `);
    stmt.run({ ...q, topic, citations: JSON.stringify(q.citations ?? []) });
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

    const r = row as any;
    return {
        ...r,
        citations: r.citations ? JSON.parse(r.citations) : []
    } as AssessmentQuestion;
}

/**
 * Gets the total count of questions in the database.
 */
export function getQuestionCount(): number {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM questions');
    const result = stmt.get() as { count: number };
    return result.count;
}
