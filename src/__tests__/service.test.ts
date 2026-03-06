import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GCPKnowledgeService } from '../service.js';

// vi.hoisted ensures this value is available when vi.mock factories are executed
// (vi.mock is hoisted above all imports by Vitest, so top-level consts aren't safe to use inside factories)
const { mockGeneratedJSON } = vi.hoisted(() => {
    const mockGeneratedJSON = JSON.stringify({
        id: 'test_q',
        question: 'mocked question',
        context: 'Mocked context.',
        referenceAnswer: 'Mocked reference answer.',
        reasoning: 'mocked reasoning',
        isCorrect: true,
        feedback: 'Mocked feedback.'
    });
    return { mockGeneratedJSON };
});

vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class {
            models = {
                generateContent: vi.fn().mockImplementation(({ config }) => {
                    // If the schema is an ARRAY type, return array (question generation)
                    const isArray = config?.responseSchema?.type === 'array';
                    const text = isArray
                        ? JSON.stringify([JSON.parse(mockGeneratedJSON)])
                        : mockGeneratedJSON;
                    return Promise.resolve({ text });
                })
            };
        },
        Type: { OBJECT: 'object', STRING: 'string', BOOLEAN: 'boolean', ARRAY: 'array' }
    };
});

vi.mock('google-auth-library', () => {
    return {
        GoogleAuth: class {
            getAccessToken = vi.fn().mockResolvedValue('mock-token');
            getClient = vi.fn().mockResolvedValue({
                getRequestHeaders: vi.fn().mockResolvedValue({})
            });
        }
    };
});

describe('GCPKnowledgeService', () => {

    beforeEach(() => {
        vi.clearAllMocks();
        // Stub global fetch so callMCP never makes real network requests.
        // Returns an empty content array so the pre-fetch completes successfully
        // (prefetchSucceeded = true) and the agent runs without redundant tool calls.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ result: { content: [] } }),
            text: vi.fn().mockResolvedValue('')
        }));
    });

    it('should generate a question successfully', async () => {
        const agent = new GCPKnowledgeService();
        const result = await agent.generateQuestion('Vertex test');

        expect(result).toBeDefined();
        expect(result.id).toBe('test_q');
        expect(result.question).toContain('mocked question');
        expect(result.context).toBe('Mocked context.');
        expect(result.referenceAnswer).toBe('Mocked reference answer.');
    });

    it('should evaluate an answer successfully', async () => {
        const agent = new GCPKnowledgeService();
        const evalResult = await agent.evaluateAnswer(
            {
                id: 'test_q',
                question: 'mock question',
                context: 'mock ctx',
                referenceAnswer: 'mock ref',
                citations: []
            },
            'User answer xyz'
        );

        expect(evalResult).toBeDefined();
        expect(evalResult.questionId).toBe('test_q');
        expect(evalResult.isCorrect).toBe(true);
        expect(evalResult.feedback).toBe('Mocked feedback.');
        expect(evalResult.reasoning).toBe('mocked reasoning');
    });
});
