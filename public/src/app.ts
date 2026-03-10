import { initializeApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, onIdTokenChanged, signOut } from "firebase/auth";

let auth: any;
let googleProvider: any;
let currentIdToken: string | null = null;

// Async Initializer
async function initializeFirebase() {
    try {
        const res = await fetch("/api/config");
        const data = await res.json();

        if (!data.success || !data.config.apiKey) {
            throw new Error("API Key missing from backend response.");
        }

        const app = initializeApp(data.config);
        auth = getAuth(app);
        googleProvider = new GoogleAuthProvider();

        console.log("🔥 Firebase initialized successfully from runtime config.");
        setupAuthListener(); // Move the listener setup here
    } catch (e) {
        console.error("❌ Failed to initialize Firebase:", e);
        alert("Authentication setup failed. Please try reloading the page.");
    }
}


// Local interfaces for payload typing
export interface AssessmentQuestion {
    id: string;
    question: string;
    context: string;
    referenceAnswer: string;
}

export interface AssessmentResult {
    questionId: string;
    status: 'CORRECT' | 'PARTIAL' | 'INCORRECT';
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

const answerInput = document.getElementById('answer-input') as HTMLTextAreaElement;
const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const editUsernameBtn = document.getElementById('edit-username-btn') as HTMLButtonElement;
const authStatus = document.getElementById('auth-status') as HTMLElement;
const usernameSetupGroup = document.getElementById('username-setup-group') as HTMLDivElement;
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const saveUsernameBtn = document.getElementById('save-username-btn') as HTMLButtonElement;
const usernameError = document.getElementById('username-error') as HTMLParagraphElement;
const saveUserLoader = document.getElementById('save-user-loader') as HTMLDivElement;
const leaderboardList = document.getElementById('leaderboard-list') as HTMLTableSectionElement;

const landingSection = document.getElementById('landing-section') as HTMLElement;
const appShell = document.getElementById('app-shell') as HTMLElement;
const tabQuiz = document.getElementById('tab-quiz') as HTMLElement;
const tabLeaderboard = document.getElementById('tab-leaderboard') as HTMLElement;
const quizView = document.getElementById('quiz-view') as HTMLElement;
const leaderboardView = document.getElementById('leaderboard-view') as HTMLElement;

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

const scenarioRibbon = document.getElementById('scenario-ribbon') as HTMLElement;
const scoreDisplay = document.getElementById('score-display') as HTMLElement;

let currentQuestion: AssessmentQuestion | null = null;
let currentSessionId: string | null = null;
let currentUsername: string = "";

// API Helpers
interface ApiResponse {
    success: boolean;
    sessionId?: string;
    question?: AssessmentQuestion;
    result?: AssessmentResult;
    error?: string;
    questionCount?: number;
    pointsEarned?: number;
    totalScore?: number;
    isGameOver?: boolean;
}

interface LeaderboardResponse {
    success: boolean;
    leaderboard?: Array<{ id: string, score: number }>;
}

/**
 * POST to an SSE endpoint, calling onProgress for each progress event,
 * and resolving with the final result payload.
 * Includes a 120-second timeout to prevent the UI from freezing.
 */
async function fetchSSE(url: string, data: object, onProgress: (step: string) => void): Promise<ApiResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000); // 120s timeout

    try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (currentIdToken) {
            headers['Authorization'] = `Bearer ${currentIdToken}`;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(data),
            signal: controller.signal
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
    } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
            throw new Error('Request timed out. The server took too long to respond. Please try again.');
        }
        throw e;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchLeaderboard(): Promise<void> {
    try {
        const res = await fetch("/api/leaderboard");
        const data = await res.json() as LeaderboardResponse;
        if (data.success && data.leaderboard) {
            // Hardcode top 3 podium if we want, but for now let's just populate the table with everyone
            // For a truly robust implementation, we would segregate the top 3 to the bento boxes,
            // and the rest to the table. Let's do exactly that.

            const top3 = data.leaderboard.slice(0, 3);
            const rest = data.leaderboard.slice(3);

            // Populate Podium
            const p1 = top3[0];
            const p2 = top3[1];
            const p3 = top3[2];

            const p1Name = document.getElementById('podium-1-name');
            const p1Id = document.getElementById('podium-1-id');
            const p1Pts = document.getElementById('podium-1-pts');
            if (p1Name && p1Id && p1Pts && p1) {
                p1Name.textContent = p1.id;
                p1Id.textContent = "ID: ..."; // We don't have secondary IDs in our DB yet
                p1Pts.innerHTML = `${p1.score} <span class="text-xs text-white/70 font-normal">pts</span>`;
            }

            const p2Name = document.getElementById('podium-2-name');
            const p2Id = document.getElementById('podium-2-id');
            const p2Pts = document.getElementById('podium-2-pts');
            if (p2Name && p2Id && p2Pts && p2) {
                p2Name.textContent = p2.id;
                p2Id.textContent = "ID: ...";
                p2Pts.innerHTML = `${p2.score} <span class="text-[10px] text-on-surface-variant font-normal">pts</span>`;
            }

            const p3Name = document.getElementById('podium-3-name');
            const p3Id = document.getElementById('podium-3-id');
            const p3Pts = document.getElementById('podium-3-pts');
            if (p3Name && p3Id && p3Pts && p3) {
                p3Name.textContent = p3.id;
                p3Id.textContent = "ID: ...";
                p3Pts.innerHTML = `${p3.score} <span class="text-[10px] text-on-surface-variant font-normal">pts</span>`;
            }

            // Populate Table
            leaderboardList.innerHTML = "";
            rest.forEach((u, index) => {
                const tr = document.createElement("tr");
                const actualRank = index + 4; // Because top 3 are in the podium

                // Highlight the current user if they match
                const isCurrentUser = currentUsername === u.id;
                tr.className = isCurrentUser
                    ? "bg-primary-fixed/50 relative group"
                    : "hover:bg-primary-fixed/30 transition-colors group";

                const rankColorClass = isCurrentUser ? "text-primary" : "text-on-surface-variant/50";
                const nameColorClass = isCurrentUser ? "text-primary" : "";
                const scoreColorClass = isCurrentUser ? "text-primary text-xl" : "text-primary";

                const youBadge = isCurrentUser ? `<span class="ml-2 text-[10px] bg-primary text-white px-2 py-0.5 rounded-full uppercase">You</span>` : '';

                tr.innerHTML = `
                    <td class="px-8 py-6 font-headline font-bold text-lg ${rankColorClass}">${actualRank}</td>
                    <td class="px-8 py-6 flex items-center gap-3">
                        <img class="w-8 h-8 rounded-full ${isCurrentUser ? 'border-2 border-primary' : ''}" data-alt="Avatar" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAwrKFrgIHggiIP0-LBXSiakfc8hGTyiDxdGaB5saQ1jdnBGH2RzTK5Q4If3N4Hrna-pzxqpHZGW55zo71ZWzhHhpplF_27fxja0D8SKguC53yx6fYwgnFUzESnaRF8bFwhMCFcqH299pGENDoF8Q_h635C9LS77bfesgvF9PJE6TTBhX2VhoFjdCHHAKvYrZqkoMWJRuBA5Lysb74NwtELDHg__JehVNgf1wCluyCGClsdYaPLH5l7_WWKre55qrx3VAx8RUoboyIU"/>
                        <span class="font-bold ${nameColorClass}">${u.id} ${youBadge}</span>
                    </td>
                    <td class="px-8 py-6 font-label text-sm ${isCurrentUser ? 'text-primary/70 font-semibold' : 'text-on-surface-variant'}">USR-${Math.floor(Math.random() * 9000) + 1000}</td>
                    <td class="px-8 py-6">
                        ${isCurrentUser
                        ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary text-white">Active session</span>`
                        : `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Online</span>`
                    }
                    </td>
                    <td class="px-8 py-6 text-right font-headline font-extrabold ${scoreColorClass}">${u.score}</td>
                `;
                leaderboardList.appendChild(tr);
            });

            if (data.leaderboard.length === 0) {
                leaderboardList.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-on-surface-variant">No scores yet. Ascend the stratosphere!</td></tr>`;
            } else if (rest.length === 0) {
                leaderboardList.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-on-surface-variant">More architects needed to fill the global rankings.</td></tr>`;
            }
        }
    } catch (e) {
        console.error("Leaderboard error:", e);
    }
}

// Initial Fetch
fetchLeaderboard();

// Tab Navigation
tabQuiz.addEventListener('click', () => {
    tabQuiz.classList.add('active');
    tabLeaderboard.classList.remove('active');
    quizView.classList.remove('hidden');
    leaderboardView.classList.add('hidden');
});

tabLeaderboard.addEventListener('click', () => {
    tabLeaderboard.classList.add('active');
    tabQuiz.classList.remove('active');
    leaderboardView.classList.remove('hidden');
    quizView.classList.add('hidden');
    fetchLeaderboard();
});


// Auth Handlers
loginBtn.addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error("Login failed:", error);
    }
});

logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);

        // Soft reset UI if user logs out mid-game
        assessmentSection.classList.remove("active-section");
        resultSection.classList.remove("active-section");
        generateSection.classList.add("active-section");
        currentSessionId = null;
    } catch (error) {
        console.error("Logout failed:", error);
    }
});

async function checkUserProfile() {
    if (!currentIdToken) return;

    try {
        const res = await fetch('/api/user', {
            headers: { 'Authorization': `Bearer ${currentIdToken}` }
        });
        const data = await res.json();

        if (data.success && data.user) {
            // User has a username
            currentUsername = data.user.username;
            authStatus.textContent = currentUsername;
            logoutBtn.classList.remove('hidden');
            editUsernameBtn.classList.remove('hidden');
            usernameSetupGroup.classList.add('hidden');
            generateBtn.disabled = false;
        } else if (data.success && !data.user) {
            // New user, needs username
            authStatus.textContent = `Finish setup to play.`;
            logoutBtn.classList.remove('hidden');
            editUsernameBtn.classList.add('hidden');
            usernameSetupGroup.classList.remove('hidden');
            generateBtn.disabled = true; // Block until set
        }
    } catch (e) {
        console.error("Failed to check user profile:", e);
    }
}

function setupAuthListener() {
    onIdTokenChanged(auth, async (user) => {
        if (user) {
            currentIdToken = await user.getIdToken();

            // Show app shell, hide landing
            landingSection.classList.add('hidden');
            appShell.classList.remove('hidden');

            await checkUserProfile();
        } else {
            currentIdToken = null;

            // Show landing, hide app shell
            landingSection.classList.remove('hidden');
            appShell.classList.add('hidden');

            authStatus.textContent = '';
            logoutBtn.classList.add('hidden');
            editUsernameBtn.classList.add('hidden');
            usernameSetupGroup.classList.add('hidden');
            generateBtn.disabled = true;
        }
    });
}

// Start Initialization
initializeFirebase();


editUsernameBtn.addEventListener('click', () => {
    usernameInput.value = currentUsername;
    editUsernameBtn.classList.add('hidden');
    usernameSetupGroup.classList.remove('hidden');
    generateBtn.disabled = true;
});

saveUsernameBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    if (!username) return;

    saveUserLoader.classList.remove('hidden');
    saveUsernameBtn.disabled = true;
    usernameError.style.display = 'none';

    try {
        const res = await fetch('/api/user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentIdToken}`
            },
            body: JSON.stringify({ username })
        });
        const data = await res.json();

        if (data.success) {
            await checkUserProfile();
        } else {
            usernameError.textContent = data.error || "Failed to save username.";
            usernameError.style.display = 'block';
        }
    } catch (e) {
        usernameError.textContent = "Network error. Try again.";
        usernameError.style.display = 'block';
    } finally {
        saveUserLoader.classList.add('hidden');
        saveUsernameBtn.disabled = false;
    }
});

// Flow Handlers
generateBtn.disabled = true;

generateBtn.addEventListener('click', async () => {

    // UI Loading state
    generateBtn.classList.add('btn-loading');
    generateBtn.disabled = true;
    genStatus.textContent = 'Starting...';
    genStatus.classList.remove('hidden');

    try {
        const payload: any = {};
        if (currentSessionId) payload.sessionId = currentSessionId;

        const res = await fetchSSE('/api/generate', payload, (step) => {
            genStatus.textContent = step;
        });

        if (res.success && res.question) {
            currentQuestion = res.question;
            currentSessionId = res.sessionId ?? null;

            // Populate assessment UI
            contextDisplay.textContent = currentQuestion?.context || 'No specific context provided.';
            questionDisplay.textContent = currentQuestion?.question || '';

            scenarioRibbon.textContent = "QUESTION " + res.questionCount + " OF 10";

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
            scoreDisplay.textContent = res.totalScore?.toString() || "0";

            // Populate Result UI
            if (resultObj.status === 'CORRECT') {
                resultTitle.textContent = "✅ CORRECT (+" + res.pointsEarned + " pts)";
                resultTitle.className = 'result-title result-success';
            } else if (resultObj.status === 'PARTIAL') {
                resultTitle.textContent = "⚠️ PARTIAL (+" + res.pointsEarned + " pts)";
                resultTitle.className = "result-title";
                resultTitle.style.color = "#ffb300";
            } else {
                resultTitle.textContent = "❌ INCORRECT (0 pts)";
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

            if (res.isGameOver) {
                resetBtn.textContent = "Game Over! Play Again";
                currentSessionId = null; // Clear session to restart
                fetchLeaderboard();
            } else {
                resetBtn.textContent = "Next Question";
            }

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

    if (!currentSessionId) {
        // It was a Game Over, so do a hard reset of UI
        scoreDisplay.textContent = "0";
    }

    // Transition UI back to start
    resultSection.classList.remove('active-section');
    resultSection.classList.add('hidden');

    if (currentSessionId) {
        generateBtn.click();
    } else {
        generateSection.classList.remove('hidden');
        generateSection.classList.add('active-section');
    }
});
