import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, insertQuestion, getRandomQuestion } from '../db.js';

describe('Database Category Selection', () => {
    const testTopic = 'TEST_SPECIFIC_TOPIC_' + Date.now();
    const testQuestionId = 'test_q_topic_' + Date.now();

    beforeAll(() => {
        // Insert a question with a specific topic
        insertQuestion({
            id: testQuestionId,
            question: 'Mock question for category testing',
            context: 'Mock context',
            referenceAnswer: 'Mock answer',
            citations: ['doc1']
        }, testTopic);
        
        // Insert another question with a different topic to ensure filtering works
        insertQuestion({
            id: testQuestionId + '_other',
            question: 'Mock question another',
            context: 'Mock context',
            referenceAnswer: 'Mock answer',
            citations: ['doc2']
        }, 'OTHER_TOPIC_' + Date.now());
    });

    afterAll(() => {
        // Cleanup test data
        // We use prepare to safely delete and avoid SQL injection, even in tests
        const stmt = db.prepare('DELETE FROM questions WHERE id IN (?, ?)');
        stmt.run(testQuestionId, testQuestionId + '_other');
    });

    it('should fetch a random question strictly filtered by the selected topic', () => {
        const result = getRandomQuestion(testTopic);
        
        expect(result).toBeDefined();
        expect(result?.id).toBe(testQuestionId);
        expect((result as any)?.topic).toBe(testTopic); // Ensures the topic matches via the 'LIKE' query
    });
    
    it('should return null when fetching a non-existent topic', () => {
        const result = getRandomQuestion('NON_EXISTENT_TOPIC_123456789');
        expect(result).toBeNull();
    });
});
