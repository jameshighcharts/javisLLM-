import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "../api";

type AuthContextType = {
	isInitialized: boolean;
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

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [session, setSession] = useState<Session | null>(null);
	const [user, setUser] = useState<User | null>(null);
	const [isInitialized, setIsInitialized] = useState(false);

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
		if (!supabase) {
			console.warn("Supabase client is not configured, bypassing auth.");
			setIsInitialized(true);
			return;
		}

		supabase.auth
			.getSession()
			.then(({ data: { session } }: { data: { session: Session | null } }) => {
				setSession(session);
				setUser(session?.user ?? null);
				setIsInitialized(true);
			});

		const {
			data: { subscription },
		} = supabase.auth.onAuthStateChange(
			(_event: AuthChangeEvent, session: Session | null) => {
				setSession(session);
				setUser(session?.user ?? null);
			},
		);

		return () => subscription.unsubscribe();
	}, []);

	const signInWithOtp = async (email: string) => {
		if (!isAllowedMagicLinkEmail(email)) {
			return {
				error: new Error(
					"Only @highsoft email addresses can receive a magic link.",
				),
			};
		}
		if (!supabase) return { error: new Error("Supabase not configured") };
		const { error } = await supabase.auth.signInWithOtp({
			email,
			options: {
				emailRedirectTo: getMagicLinkRedirectUrl(),
			},
		});
		return { error };
	};

	const signOut = async () => {
		if (!supabase) return;
		await supabase.auth.signOut();
	};

	return (
		<AuthContext.Provider
			value={{ session, user, isInitialized, signInWithOtp, signOut }}
		>
			{children}
		</AuthContext.Provider>
	);
}
