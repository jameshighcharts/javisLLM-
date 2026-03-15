import { motion } from "framer-motion";
import {
	Activity,
	Bot,
	Layers,
	LayoutTemplate,
	Link2,
	Server,
	Target,
} from "lucide-react";
import CitationIntelligenceFeature from "./CitationIntelligenceFeature";
import CompetitorAnalysisFeature from "./CompetitorAnalysisFeature";
// Import components
import DashboardFeature from "./DashboardFeature";
import PerformanceAnalyticsFeature from "./PerformanceAnalyticsFeature";
import PromptDrilldownFeature from "./PromptDrilldownFeature";
import QueryLabFeature from "./QueryLabFeature";
import ResearchCohortsFeature from "./ResearchCohortsFeature";

export default function FeatureShowcase() {
	return (
		<div className="max-w-7xl mx-auto w-full pt-16 pb-32 space-y-40 px-6 md:px-0">
			{/* Dashboard Showcase */}
			<div className="flex flex-col gap-10">
				<motion.div
					initial={{ opacity: 0, y: 30 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-100px" }}
					transition={{ duration: 0.8 }}
					className="max-w-3xl mx-auto text-center space-y-6"
				>
					<div
						className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold tracking-wide"
						style={{ background: "#F0FDF4", color: "#15803D" }}
					>
						<Activity size={16} /> Live Dashboard & Engine
					</div>
					<h3 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A3A2C]">
						One score for your entire AI presence.
					</h3>
					<p className="text-lg leading-relaxed text-[#6E8370]">
						The AI Visibility Score aggregates mention rate, share of voice, and
						competitive positioning into a single KPI. Track massive multi-model
						benchmark runs directly and watch the data flow in real-time.
					</p>
				</motion.div>
				<DashboardFeature />
			</div>

			{/* Competitor Analysis Showcase */}
			<div className="flex flex-col gap-10">
				<motion.div
					initial={{ opacity: 0, y: 30 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-100px" }}
					transition={{ duration: 0.8 }}
					className="max-w-3xl mx-auto text-center space-y-6"
				>
					<div
						className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold tracking-wide"
						style={{ background: "#FFF7ED", color: "#C2410C" }}
					>
						<LayoutTemplate size={16} /> Competitor Insights
					</div>
					<h3 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A3A2C]">
						Know exactly where you stand.
					</h3>
					<p className="text-lg leading-relaxed text-[#6E8370]">
						Don't just measure yourself in a vacuum. Track your Share of Voice
						and head-to-head gaps against every competitor in your space,
						updated across all major LLMs.
					</p>
				</motion.div>
				<div className="max-w-5xl mx-auto w-full">
					<CompetitorAnalysisFeature />
				</div>
			</div>

			{/* Citation Intelligence Showcase */}
			<div className="flex flex-col gap-10">
				<motion.div
					initial={{ opacity: 0, y: 30 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-100px" }}
					transition={{ duration: 0.8 }}
					className="max-w-3xl mx-auto text-center space-y-6"
				>
					<div
						className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold tracking-wide"
						style={{ background: "#F3F4F6", color: "#1F2937" }}
					>
						<Link2 size={16} /> Source Optimization
					</div>
					<h3 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A3A2C]">
						Discover who feeds the models.
					</h3>
					<p className="text-lg leading-relaxed text-[#6E8370]">
						Automatically extract and rank the citations LLMs use in their
						answers. Know precisely which third-party domains to target for PR
						and backlinking to move the needle.
					</p>
				</motion.div>
				<div className="max-w-5xl mx-auto w-full">
					<CitationIntelligenceFeature />
				</div>
			</div>

			{/* Performance Analytics Showcase */}
			<div className="flex flex-col gap-10">
				<motion.div
					initial={{ opacity: 0, y: 30 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-100px" }}
					transition={{ duration: 0.8 }}
					className="max-w-3xl mx-auto text-center space-y-6"
				>
					<div
						className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold tracking-wide"
						style={{
							background: "#F9FAFB",
							color: "#4B5563",
							border: "1px solid #E5E7EB",
						}}
					>
						<Server size={16} /> Enterprise Infrastructure
					</div>
					<h3 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A3A2C]">
						Complete transparency on cost.
					</h3>
					<p className="text-lg leading-relaxed text-[#6E8370]">
						Track exact token consumption, monitor API latency bottlenecks
						during web-grounded queries, and estimate your monthly AI
						infrastructure spend before you run jobs.
					</p>
				</motion.div>
				<div className="max-w-5xl mx-auto w-full">
					<PerformanceAnalyticsFeature />
				</div>
			</div>

			{/* Query Lab Showcase */}
			<div className="flex flex-col gap-10">
				<motion.div
					initial={{ opacity: 0, y: 30 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-100px" }}
					transition={{ duration: 0.8 }}
					className="max-w-3xl mx-auto text-center space-y-6"
				>
					<div
						className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold tracking-wide"
						style={{
							background: "#EFF6FF",
							color: "#1D4ED8",
							border: "1px solid #BFDBFE",
						}}
					>
						<Bot size={16} /> Live Query Runner
					</div>
					<h3 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A3A2C]">
						Test hypothesis in real-time.
					</h3>
					<p className="text-lg leading-relaxed text-[#6E8370]">
						Skip the batch jobs. Enter a query and run it against GPT-4o, Claude
						3.5, and Gemini simultaneously. Watch responses stream in
						side-by-side with automatic entity detection.
					</p>
				</motion.div>
				<div className="max-w-5xl mx-auto w-full">
					<QueryLabFeature />
				</div>
			</div>

			{/* Prompt Drilldown Showcase */}
			<div className="flex flex-col gap-10">
				<motion.div
					initial={{ opacity: 0, y: 30 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-100px" }}
					transition={{ duration: 0.8 }}
					className="max-w-3xl mx-auto text-center space-y-6"
				>
					<div
						className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold tracking-wide"
						style={{
							background: "#F5F3FF",
							color: "#6D28D9",
							border: "1px solid #DDD6FE",
						}}
					>
						<Layers size={16} /> Micro-Analysis
					</div>
					<h3 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A3A2C]">
						Zoom into the atomic level.
					</h3>
					<p className="text-lg leading-relaxed text-[#6E8370]">
						Go from aggregate dashboard scores straight down to individual
						prompts. Analyze trend lines for highly specific queries and read
						the raw LLM responses that drove the metrics.
					</p>
				</motion.div>
				<div className="max-w-5xl mx-auto w-full">
					<PromptDrilldownFeature />
				</div>
			</div>

			{/* Research Cohorts Showcase */}
			<div className="flex flex-col gap-10">
				<motion.div
					initial={{ opacity: 0, y: 30 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, margin: "-100px" }}
					transition={{ duration: 0.8 }}
					className="max-w-3xl mx-auto text-center space-y-6"
				>
					<div
						className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-semibold tracking-wide"
						style={{
							background: "#FFF1F2",
							color: "#BE123C",
							border: "1px solid #FECDD3",
						}}
					>
						<Target size={16} /> Content Gap Workflows
					</div>
					<h3 className="text-4xl md:text-5xl font-bold leading-tight tracking-tight text-[#2A3A2C]">
						Turn data into strategy.
					</h3>
					<p className="text-lg leading-relaxed text-[#6E8370]">
						Identify topics where competitors outrank you with AI. Track these
						gaps through a lightweight kanban workflow, generate immediate AI
						briefs, and monitor the uplift automatically in the next benchmark
						run.
					</p>
				</motion.div>
				<div className="max-w-5xl mx-auto w-full">
					<ResearchCohortsFeature />
				</div>
			</div>
		</div>
	);
}
