import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../api";

type AuthContextType = {
	isInitialized: boolean;
	authUnavailable: boolean;
	session: Session | null;
	user: User | null;
	signInWithOtp: (email: string) => Promise<{ error: any }>;
	signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeEmailDomain(email: string): string | null {
	const normalized = email.trim().toLowerCase();
	const parts = normalized.split("@");
	if (parts.length !== 2) {
		return null;
	}
	const domain = parts[1].trim();
	return domain || null;
}

export function isAllowedMagicLinkEmail(email: string): boolean {
	const domain = normalizeEmailDomain(email);
	return domain === "highsoft" || domain === "highsoft.com";
}

function isLocalAuthBypassEnabled(): boolean {
	return (
		import.meta.env.DEV &&
		String(import.meta.env.VITE_AUTH_BYPASS ?? "").trim().toLowerCase() ===
			"true"
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}

function isSupabaseFetchFailure(error: unknown): boolean {
	const parts = new Set<string>();
	const visited = new Set<object>();

	function collect(value: unknown, depth = 0): void {
		if (!value || depth > 3) {
			return;
		}
		if (typeof value === "string") {
			parts.add(value);
			return;
		}
		if (typeof value !== "object") {
			return;
		}
		if (visited.has(value)) {
			return;
		}
		visited.add(value);

		const record = value as {
			message?: unknown;
			name?: unknown;
			code?: unknown;
			cause?: unknown;
		};

		if (typeof record.message === "string") {
			parts.add(record.message);
		}
		if (typeof record.name === "string") {
			parts.add(record.name);
		}
		if (typeof record.code === "string") {
			parts.add(record.code);
		}
		if (record.cause !== undefined) {
			collect(record.cause, depth + 1);
		}
	}

	collect(error);
	const normalized = [...parts].join(" ").toLowerCase();
	return (
		normalized.includes("failed to fetch") ||
		normalized.includes("fetch failed") ||
		normalized.includes("networkerror") ||
		normalized.includes("network error") ||
		normalized.includes("enotfound") ||
		normalized.includes("econnrefused") ||
		normalized.includes("etimedout")
	);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [session, setSession] = useState<Session | null>(null);
	const [user, setUser] = useState<User | null>(null);
	const [isInitialized, setIsInitialized] = useState(false);
	const [authUnavailable, setAuthUnavailable] = useState(false);

	function getMagicLinkRedirectUrl() {
		const configuredRedirect =
			import.meta.env.VITE_SUPABASE_REDIRECT_URL as string | undefined;
		if (configuredRedirect && configuredRedirect.trim()) {
			return configuredRedirect.trim();
		}

		if (typeof window !== "undefined") {
			return new URL("/login", window.location.origin).toString();
		}

		return "/login";
	}

	useEffect(() => {
		if (isLocalAuthBypassEnabled()) {
			console.warn("Local auth bypass is enabled, bypassing login.");
			setAuthUnavailable(true);
			setIsInitialized(true);
			return;
		}

		const client = supabase;
		if (!client) {
			console.warn("Supabase client is not configured, bypassing auth.");
			setAuthUnavailable(true);
			setIsInitialized(true);
			return;
		}

		let active = true;
		let subscription: { unsubscribe: () => void } | null = null;

		const initializeAuth = async () => {
			try {
				const {
					data: { session },
				} = await client.auth.getSession();
				if (!active) {
					return;
				}
				setSession(session);
				setUser(session?.user ?? null);
				const authState = client.auth.onAuthStateChange(
					(_event: AuthChangeEvent, nextSession: Session | null) => {
						if (!active) {
							return;
						}
						setSession(nextSession);
						setUser(nextSession?.user ?? null);
					},
				);
				subscription = authState.data.subscription;
				setIsInitialized(true);
			} catch (error) {
				if (!active) {
					return;
				}
				if (isSupabaseFetchFailure(error)) {
					console.warn("Supabase auth is unavailable, bypassing login.");
					setAuthUnavailable(true);
				} else {
					console.error("Supabase auth initialization failed", error);
				}
				setSession(null);
				setUser(null);
				setIsInitialized(true);
			}
		};

		void initializeAuth();

		return () => {
			active = false;
			subscription?.unsubscribe();
		};
	}, []);

	const signInWithOtp = async (email: string) => {
		if (!isAllowedMagicLinkEmail(email)) {
			return {
				error: new Error(
					"Only @highsoft email addresses can receive a magic link.",
				),
			};
		}
		if (authUnavailable || !supabase) {
			return {
				error: new Error("Authentication is unavailable in this deployment."),
			};
		}
		const client = supabase;
		try {
			const { error } = await client.auth.signInWithOtp({
				email,
				options: {
					emailRedirectTo: getMagicLinkRedirectUrl(),
				},
			});
			if (error && isSupabaseFetchFailure(error)) {
				setAuthUnavailable(true);
			}
			return { error };
		} catch (error) {
			if (isSupabaseFetchFailure(error)) {
				setAuthUnavailable(true);
			}
			return {
				error:
					error instanceof Error ? error : new Error(String(error ?? "Unknown error")),
			};
		}
	};

	const signOut = async () => {
		if (authUnavailable || !supabase) return;
		const client = supabase;
		await client.auth.signOut();
	};

	return (
		<AuthContext.Provider
			value={{
				session,
				user,
				isInitialized,
				authUnavailable,
				signInWithOtp,
				signOut,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
}
