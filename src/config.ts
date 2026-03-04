import 'dotenv/config';
import process from 'node:process';

export interface AgentConfig {
    projectId?: string;
    location?: string;
    apiKey?: string;
    modelName?: string;
}

export function getConfig(): AgentConfig {
    const projectId = process.env['GOOGLE_CLOUD_PROJECT'];
    const location = process.env['GOOGLE_CLOUD_LOCATION'] || 'global';
    const apiKey = process.env['GEMINI_API_KEY'];

    // Provide logging to alert the user about their configuration path
    if (projectId) {
        console.log(`Using Vertex AI for project: ${projectId}`);
    } else {
        console.log("Using standard Gemini API.");
        if (!apiKey) {
            console.error("Warning: GEMINI_API_KEY environment variable is not set.");
            console.error("Please set it before running the agent if using the default AI models.");
        }
    }

    const modelName = process.env['GEMINI_MODEL'] || 'gemini-3-flash-preview';

    const result: AgentConfig = { modelName };
    if (projectId) {
        result.projectId = projectId;
        result.location = location;
    }
    if (apiKey) result.apiKey = apiKey;

    return result;
}
