import { z } from "zod";

export const HealthResponseSchema = z.object({
	ok: z.boolean(),
	service: z.string().optional(),
	repoRoot: z.string().optional(),
});

export const BillingPortalResponseSchema = z.object({
	url: z.string().url(),
});

export const BenchmarkTriggerResponseSchema = z.object({
	ok: z.boolean(),
	runId: z.string().optional(),
	jobsEnqueued: z.number().optional(),
	models: z.array(z.string()).optional(),
	promptLimit: z.number().nullable().optional(),
	runMonth: z.string().optional(),
	message: z.string(),
});

export const BenchmarkStopResponseSchema = z.object({
	ok: z.boolean(),
	runId: z.string().optional(),
	cancelledJobs: z.number().optional(),
	message: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type BillingPortalResponse = z.infer<typeof BillingPortalResponseSchema>;
export type BenchmarkTriggerResponse = z.infer<
	typeof BenchmarkTriggerResponseSchema
>;
export type BenchmarkStopResponse = z.infer<typeof BenchmarkStopResponseSchema>;
