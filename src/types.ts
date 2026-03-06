import { z } from "zod";

// ---------------------------------------------------------------------------
// Zod schemas — used both for TypeScript type inference and runtime validation
// of model output. This ensures the model cannot silently hallucinate a wrong
// shape that would pass a `JSON.parse(...) as T` blind cast.
// ---------------------------------------------------------------------------

export const AssessmentQuestionSchema = z.object({
    id: z.string().min(1, "Question id must not be empty."),
    question: z.string().min(1, "Question text must not be empty."),
    context: z.string().min(1, "Context must not be empty."),
    referenceAnswer: z.string().min(1, "Reference answer must not be empty."),
    citations: z.array(z.string()).default([]),
});

export const AssessmentResultSchema = z.object({
    questionId: z.string(),
    isCorrect: z.boolean(),
    reasoning: z.string().min(1, "Reasoning must not be empty."),
    feedback: z.string().min(1, "Feedback must not be empty."),
    sourcesUsed: z.array(z.string()),
    citations: z.array(z.string()).default([]),
});

// Intermediate schema for the raw evaluation output (before we enrich it with
// questionId and sourcesUsed, which come from the calling context, not the model).
export const EvaluationOutputSchema = z.object({
    isCorrect: z.boolean(),
    reasoning: z.string().min(1, "Reasoning must not be empty."),
    feedback: z.string().min(1, "Feedback must not be empty."),
    citations: z.array(z.string()).default([]),
});

// TypeScript types inferred directly from the schemas — no need to maintain
// separate interface declarations that can drift out of sync.
export type AssessmentQuestion = z.infer<typeof AssessmentQuestionSchema>;
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;
export type EvaluationOutput = z.infer<typeof EvaluationOutputSchema>;
