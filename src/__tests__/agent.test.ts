import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CEAssessmentAgent } from '../agent.js';

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

vi.mock('@google/genai', () => ({
    Type: { OBJECT: 'object', STRING: 'string', BOOLEAN: 'boolean' }
}));

vi.mock('@google/adk', () => {
    return {
        Gemini: class { },
        LlmAgent: class {
            name = 'assessment_evaluator_agent';
        },
        MCPToolset: class {
            getTools = vi.fn().mockResolvedValue([]);
            close = vi.fn().mockResolvedValue(undefined);
        },
        InMemoryRunner: class {
            appName = 'InMemoryRunner';
            sessionService = {
                createSession: vi.fn().mockResolvedValue({})
            };
            runAsync = vi.fn().mockImplementation(async function* () {
                yield {
                    content: true,
                    author: 'assessment_evaluator_agent',
                };
            });
        },
        stringifyContent: vi.fn().mockReturnValue(mockGeneratedJSON),
        FunctionTool: class { }
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

describe('CEAssessmentAgent', () => {

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
        const agent = new CEAssessmentAgent();
        const result = await agent.generateQuestion('Vertex test');

        expect(result).toBeDefined();
        expect(result.id).toBe('test_q');
        expect(result.question).toContain('mocked question');
        expect(result.context).toBe('Mocked context.');
        expect(result.referenceAnswer).toBe('Mocked reference answer.');
    });

    it('should evaluate an answer successfully', async () => {
        const agent = new CEAssessmentAgent();
        const evalResult = await agent.evaluateAnswer(
            {
                id: 'test_q',
                question: 'mock question',
                context: 'mock ctx',
                referenceAnswer: 'mock ref'
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
