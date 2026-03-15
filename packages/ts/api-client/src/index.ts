import {
	type BenchmarkStopResponse,
	BenchmarkStopResponseSchema,
	type BenchmarkTriggerResponse,
	BenchmarkTriggerResponseSchema,
	type BillingPortalResponse,
	BillingPortalResponseSchema,
	type HealthResponse,
	HealthResponseSchema,
} from "@easy-llm-benchmarker/contracts";

export type RequestOptions = {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
	headers?: Record<string, string>;
};

async function request<T>(
	path: string,
	schema: { parse: (value: unknown) => T },
	options: RequestOptions = {},
): Promise<T> {
	const response = await fetch(`/api${path}`, {
		method: options.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const payload = await response.json();
	if (!response.ok) {
		const message =
			typeof payload?.error === "string"
				? payload.error
				: `Request failed: ${response.status}`;
		throw new Error(message);
	}
	return schema.parse(payload);
}

export function createApiClient() {
	return {
		health(): Promise<HealthResponse> {
			return request("/health", HealthResponseSchema);
		},
		triggerBenchmark(
			body: unknown,
			triggerToken?: string,
		): Promise<BenchmarkTriggerResponse> {
			return request("/benchmark/trigger", BenchmarkTriggerResponseSchema, {
				method: "POST",
				body,
				headers: triggerToken
					? { Authorization: `Bearer ${triggerToken}` }
					: {},
			});
		},
		stopBenchmark(
			body: unknown,
			triggerToken?: string,
		): Promise<BenchmarkStopResponse> {
			return request("/benchmark/stop", BenchmarkStopResponseSchema, {
				method: "POST",
				body,
				headers: triggerToken
					? { Authorization: `Bearer ${triggerToken}` }
					: {},
			});
		},
		createBillingPortalSession(
			body: unknown,
			authToken?: string,
		): Promise<BillingPortalResponse> {
			return request(
				"/billing/create-portal-session",
				BillingPortalResponseSchema,
				{
					method: "POST",
					body,
					headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
				},
			);
		},
	};
}
