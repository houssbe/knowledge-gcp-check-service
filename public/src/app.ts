// Local interfaces for payload typing
export interface AssessmentQuestion {
    id: string;
    question: string;
    context: string;
    referenceAnswer: string;
}

export interface AssessmentResult {
    questionId: string;
    isCorrect: boolean;
    reasoning: string;
    feedback: string;
    sourcesUsed: string[];
}

// DOM Elements
const generateSection = document.getElementById('generate-section') as HTMLElement;
const assessmentSection = document.getElementById('assessment-section') as HTMLElement;
const resultSection = document.getElementById('result-section') as HTMLElement;

const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const evaluateBtn = document.getElementById('evaluate-btn') as HTMLButtonElement;
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;

const topicSelect = document.getElementById('topic-select') as HTMLSelectElement;
const industryInput = document.getElementById('industry-input') as HTMLInputElement;
const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;

// Display elements
const contextDisplay = document.getElementById('context-display') as HTMLElement;
const questionDisplay = document.getElementById('question-display') as HTMLElement;
const resultTitle = document.getElementById('result-title') as HTMLElement;
const feedbackDisplay = document.getElementById('feedback-display') as HTMLElement;
const sourcesDisplay = document.getElementById('sources-display') as HTMLElement;
const expectedDisplay = document.getElementById('expected-display') as HTMLElement;

// Status labels
const genStatus = document.getElementById('gen-status') as HTMLElement;
const evalStatus = document.getElementById('eval-status') as HTMLElement;

let currentQuestion: AssessmentQuestion | null = null;
let currentSessionId: string | null = null;

// API Helpers
interface ApiResponse {
    success: boolean;
    sessionId?: string;
    question?: AssessmentQuestion;
    result?: AssessmentResult;
    error?: string;
}

/**
 * POST to an SSE endpoint, calling onProgress for each progress event,
 * and resolving with the final result payload.
 */
async function fetchSSE(url: string, data: object, onProgress: (step: string) => void): Promise<ApiResponse> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });

    // If the server rejected before opening a stream (e.g. 400/404), parse as JSON error
    if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({})) as ApiResponse;
        throw new Error(body.error || `Request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ApiResponse | null = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE lines end with \n; split and keep any incomplete trailing line
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
                const event = JSON.parse(line.slice(6)) as { type: string; step?: string; data?: ApiResponse; message?: string };
                if (event.type === 'progress' && event.step) {
                    onProgress(event.step);
                } else if (event.type === 'result' && event.data) {
                    result = event.data;
                } else if (event.type === 'error') {
                    throw new Error(event.message ?? 'Unknown server error');
                }
            } catch (e) {
                if (e instanceof SyntaxError) continue; // ignore non-JSON lines
                throw e;
            }
        }
    }

    if (!result) throw new Error('No result received from server.');
    return result;
}

// Flow Handlers
generateBtn.addEventListener('click', async () => {
    let topic = topicSelect.value.trim() || 'Vertex AI core capabilities';
    const industry = industryInput.value.trim();

    if (industry) {
        topic = `${topic} applied to the ${industry} industry`;
    }

    // UI Loading state
    generateBtn.classList.add('btn-loading');
    generateBtn.disabled = true;
    genStatus.textContent = 'Starting...';
    genStatus.classList.remove('hidden');

    try {
        const res = await fetchSSE('/api/generate', { topic }, (step) => {
            genStatus.textContent = step;
        });

        if (res.success && res.question) {
            currentQuestion = res.question;
            currentSessionId = res.sessionId ?? null;

            // Populate assessment UI
            contextDisplay.textContent = currentQuestion?.context || 'No specific context provided.';
            questionDisplay.textContent = currentQuestion?.question || '';
            answerInput.value = '';

            // Transition UI
            generateSection.classList.remove('active-section');
            generateSection.classList.add('hidden');

            assessmentSection.classList.remove('hidden');
            assessmentSection.classList.add('active-section');
        } else {
            alert('Failed to generate question: ' + (res.error || 'Unknown error'));
        }
    } catch (error) {
        alert('Error: ' + (error instanceof Error ? error.message : 'Could not connect to API server.'));
    } finally {
        generateBtn.classList.remove('btn-loading');
        generateBtn.disabled = false;
        genStatus.classList.add('hidden');
        genStatus.textContent = '';
    }
});

evaluateBtn.addEventListener('click', async () => {
    const userAnswer = answerInput.value.trim();
    if (!userAnswer || !currentQuestion) {
        alert('Please enter an answer before submitting.');
        return;
    }

    // UI Loading State
    evaluateBtn.classList.add('btn-loading');
    evaluateBtn.disabled = true;
    evalStatus.textContent = 'Starting...';
    evalStatus.classList.remove('hidden');

    try {
        const res = await fetchSSE('/api/evaluate', {
            sessionId: currentSessionId,
            question: currentQuestion,
            userAnswer: userAnswer
        }, (step) => {
            evalStatus.textContent = step;
        });

        if (res.success && res.result) {
            const resultObj = res.result as AssessmentResult;

            // Populate Result UI
            if (resultObj.isCorrect) {
                resultTitle.textContent = '✅ SUCCESS';
                resultTitle.className = 'result-title result-success';
            } else {
                resultTitle.textContent = '❌ NEEDS IMPROVEMENT';
                resultTitle.className = 'result-title result-fail';
            }

            feedbackDisplay.textContent = resultObj.feedback || '';
            expectedDisplay.textContent = currentQuestion.referenceAnswer || 'No reference available.';

            // Populate Sources
            sourcesDisplay.innerHTML = '';
            if (resultObj.sourcesUsed && resultObj.sourcesUsed.length > 0) {
                resultObj.sourcesUsed.forEach((src: string) => {
                    const li = document.createElement('li');
                    li.textContent = src;
                    sourcesDisplay.appendChild(li);
                });
            } else {
                const li = document.createElement('li');
                li.textContent = "No specific documentation tools were queried to verify this response.";
                sourcesDisplay.appendChild(li);
            }

            // Transition UI
            assessmentSection.classList.remove('active-section');
            assessmentSection.classList.add('hidden');

            resultSection.classList.remove('hidden');
            resultSection.classList.add('active-section');

        } else {
            alert('Evaluation failed: ' + (res.error || 'Unknown error'));
        }

    } catch (error) {
        alert('Error: ' + (error instanceof Error ? error.message : 'Could not connect to API server.'));
    } finally {
        evaluateBtn.classList.remove('btn-loading');
        evaluateBtn.disabled = false;
        evalStatus.classList.add('hidden');
        evalStatus.textContent = '';
    }
});

resetBtn.addEventListener('click', () => {
    currentQuestion = null;
    currentSessionId = null;
    topicSelect.selectedIndex = 0;
    industryInput.value = '';

    // Transition UI back to start
    resultSection.classList.remove('active-section');
    resultSection.classList.add('hidden');

    generateSection.classList.remove('hidden');
    generateSection.classList.add('active-section');
});
