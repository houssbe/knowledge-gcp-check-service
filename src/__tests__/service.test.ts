import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GCPKnowledgeService } from '../service.js';

const mocks = vi.hoisted(() => ({
    genData: {
        id: 'test_q',
        question: 'mocked question',
        context: 'Mocked context.',
        referenceAnswer: 'Mocked reference answer.',
        reasoning: 'mocked reasoning',
        isCorrect: true,
        feedback: 'Mocked feedback.',
        citations: [] as string[]
    }
}));

vi.mock('@google/genai', () => {
    return {
        GoogleGenAI: class {
            models = {
                generateContent: vi.fn().mockImplementation(({ config }) => {
                    const isArray = config?.responseSchema?.type === 'array';
                    const text = isArray
                        ? JSON.stringify([mocks.genData])
                        : JSON.stringify(mocks.genData);
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

    it('should filter out irrelevant citations during generation', async () => {
        const agent = new GCPKnowledgeService();
        
        // Mock the LLM returning one valid citation and one irrelevant citation
        mocks.genData.citations = [
            'projects/123/locations/global/collections/default/dataStores/my-store/documents/valid', 
            'projects/123/locations/global/collections/default/dataStores/my-store/documents/irrelevant'
        ];
        
        const result = await agent.generateQuestions('Vertex test', 1, {
            snippets: 'some snippet',
            parentNames: ['projects/123/locations/global/collections/default/dataStores/my-store/documents/valid']
        });

        // The service should filter out the irrelevant citation and only keep the valid one
        expect(result[0]!.citations).toEqual([
            'projects/123/locations/global/collections/default/dataStores/my-store/documents/valid'
        ]);
        
        // Reset citations for other tests
        mocks.genData.citations = [];
    });
});
