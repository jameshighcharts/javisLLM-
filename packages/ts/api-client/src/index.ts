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

type ApiClientOptions = {
	getHeaders?: () => Promise<Record<string, string>>;
};

async function request<T>(
	path: string,
	schema: { parse: (value: unknown) => T },
	clientOptions: ApiClientOptions,
	options: RequestOptions = {},
): Promise<T> {
	const authHeaders = clientOptions.getHeaders
		? await clientOptions.getHeaders()
		: {};
	const response = await fetch(`/api${path}`, {
		method: options.method ?? "GET",
		headers: {
			"Content-Type": "application/json",
			...authHeaders,
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

export function createApiClient(options: ApiClientOptions = {}) {
	return {
		health(): Promise<HealthResponse> {
			return request("/health", HealthResponseSchema, options);
		},
		triggerBenchmark(
			body: unknown,
			triggerToken?: string,
		): Promise<BenchmarkTriggerResponse> {
			return request(
				"/benchmark/trigger",
				BenchmarkTriggerResponseSchema,
				options,
				{
					method: "POST",
					body,
					headers: triggerToken ? { "X-UI-Token": triggerToken } : {},
				},
			);
		},
		stopBenchmark(
			body: unknown,
			triggerToken?: string,
		): Promise<BenchmarkStopResponse> {
			return request(
				"/benchmark/stop",
				BenchmarkStopResponseSchema,
				options,
				{
					method: "POST",
					body,
					headers: triggerToken ? { "X-UI-Token": triggerToken } : {},
				},
			);
		},
		createBillingPortalSession(
			body: unknown,
			authToken?: string,
		): Promise<BillingPortalResponse> {
			return request(
				"/billing/create-portal-session",
				BillingPortalResponseSchema,
				options,
				{
					method: "POST",
					body,
					headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
				},
			);
		},
	};
}
