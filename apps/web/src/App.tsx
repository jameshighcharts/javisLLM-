import type { ComponentType, ElementType } from "react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./components/AuthProvider";
import Layout from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Login from "./pages/Login";

type PageModule = { default: ComponentType<any> };
const pageModules = import.meta.glob(
	"./pages/{Askill,CitationLinks,CompetitorBlogs,Competitors,Dashboard,Gantt,KR23,Logics,OKR,ProductMentions,PromptDrilldown,PromptDrilldownHub,PromptResearch,Prompts,Runs,UnderTheHood}.tsx",
) as Record<string, () => Promise<PageModule>>;

function resolveLazyPage(path: string): ElementType | null {
	const loader = pageModules[path];
	return loader ? lazy(loader) : null;
}

const Askill = resolveLazyPage("./pages/Askill.tsx");
const CitationLinks = resolveLazyPage("./pages/CitationLinks.tsx");
const CompetitorBlogs = resolveLazyPage("./pages/CompetitorBlogs.tsx");
const Competitors = resolveLazyPage("./pages/Competitors.tsx");
const Dashboard = resolveLazyPage("./pages/Dashboard.tsx");
const Gantt = resolveLazyPage("./pages/Gantt.tsx");
const KR23 = resolveLazyPage("./pages/KR23.tsx");
const Logics = resolveLazyPage("./pages/Logics.tsx");
const OKR = resolveLazyPage("./pages/OKR.tsx");
const ProductMentions = resolveLazyPage("./pages/ProductMentions.tsx");
const PromptDrilldown = resolveLazyPage("./pages/PromptDrilldown.tsx");
const PromptDrilldownHub = resolveLazyPage("./pages/PromptDrilldownHub.tsx");
const PromptResearch = resolveLazyPage("./pages/PromptResearch.tsx");
const Prompts = resolveLazyPage("./pages/Prompts.tsx");
const Runs = resolveLazyPage("./pages/Runs.tsx");
const UnderTheHood = resolveLazyPage("./pages/UnderTheHood.tsx");

function LazyPageFallback() {
	return (
		<div
			className="rounded-xl border p-4 text-sm"
			style={{
				background: "#FFFFFF",
				borderColor: "#DDD0BC",
				color: "#6E8370",
			}}
		>
			Loading page...
		</div>
	);
}

function MissingPageFallback({ label }: { label: string }) {
	return (
		<div
			className="rounded-xl border p-4 text-sm"
			style={{
				background: "#FFFFFF",
				borderColor: "#F0D4A8",
				color: "#8A5A21",
			}}
		>
			{label} is not available in this build.
		</div>
	);
}

function LazyPageRoute({
	Page,
	label,
	pageProps,
}: {
	Page: ElementType | null;
	label: string;
	pageProps?: Record<string, unknown>;
}) {
	if (!Page) {
		return <MissingPageFallback label={label} />;
	}
	const ResolvedPage = Page;
	return (
		<Suspense fallback={<LazyPageFallback />}>
			<ResolvedPage {...pageProps} />
		</Suspense>
	);
}

function RootRoute() {
	const { session, isInitialized } = useAuth();

	if (!isInitialized) {
		return (
			<div
				className="min-h-screen flex items-center justify-center"
				style={{ background: "#F2EDE6" }}
			>
				<div className="animate-pulse" style={{ color: "#8FBB93" }}>
					Loading...
				</div>
			</div>
		);
	}

	return <Navigate to={session ? "/dashboard" : "/login"} replace />;
}

export default function App() {
	return (
		<AuthProvider>
			<BrowserRouter>
				<Routes>
					<Route path="/" element={<RootRoute />} />
					<Route path="/login" element={<Login />} />
					<Route
						path="/*"
						element={
							<ProtectedRoute>
								<Layout>
									<Routes>
										<Route
											path="/dashboard"
											element={
												<LazyPageRoute Page={Dashboard} label="Dashboard" />
											}
										/>
										<Route
											path="/okr/kr-2-1"
											element={<LazyPageRoute Page={OKR} label="KR 2.1" />}
										/>
										<Route
											path="/okr/kr-2-3"
											element={<LazyPageRoute Page={KR23} label="KR 2.3" />}
										/>
										<Route
											path="/runs"
											element={<LazyPageRoute Page={Runs} label="Runs" />}
										/>
										<Route
											path="/gantt"
											element={<LazyPageRoute Page={Gantt} label="Gantt" />}
										/>
										<Route
											path="/prompts"
											element={<LazyPageRoute Page={Prompts} label="Prompts" />}
										/>
										<Route
											path="/prompt-research"
											element={
												<LazyPageRoute
													Page={PromptResearch}
													label="Prompt Research"
												/>
											}
										/>
										<Route
											path="/product-mentions"
											element={
												<LazyPageRoute
													Page={ProductMentions}
													label="Product Mentions"
												/>
											}
										/>
										<Route
											path="/query-lab"
											element={
												<LazyPageRoute
													Page={Prompts}
													label="Query Lab"
													pageProps={{ queryLabOnly: true }}
												/>
											}
										/>
										<Route
											path="/prompt-drilldown"
											element={
												<LazyPageRoute
													Page={PromptDrilldownHub}
													label="Prompt Drilldown"
												/>
											}
										/>
										<Route
											path="/prompts/drilldown"
											element={
												<LazyPageRoute
													Page={PromptDrilldown}
													label="Prompt Drilldown"
												/>
											}
										/>
										<Route
											path="/competitors"
											element={
												<LazyPageRoute
													Page={Competitors}
													label="Competitors"
												/>
											}
										/>
										<Route
											path="/competitor-blogs"
											element={
												<LazyPageRoute
													Page={CompetitorBlogs}
													label="Competitor Blogs"
												/>
											}
										/>
										<Route
											path="/citation-links"
											element={
												<LazyPageRoute
													Page={CitationLinks}
													label="Citation Links"
												/>
											}
										/>
										<Route
											path="/askill"
											element={<LazyPageRoute Page={Askill} label="Askill" />}
										/>
										<Route
											path="/logics"
											element={<LazyPageRoute Page={Logics} label="Logics" />}
										/>
										<Route
											path="/under-the-hood"
											element={
												<LazyPageRoute
													Page={UnderTheHood}
													label="Under The Hood"
												/>
											}
										/>
									</Routes>
								</Layout>
							</ProtectedRoute>
						}
					/>
				</Routes>
			</BrowserRouter>
		</AuthProvider>
	);
}
