/* biome-ignore-all lint/a11y/noSvgWithoutTitle: decorative inline icons */
import { motion } from "framer-motion";
import {
	Activity,
	ArrowRight,
	CheckSquare,
	FileText,
	Sparkles,
	Target,
} from "lucide-react";

export default function ResearchCohortsFeature() {
	return (
		<div
			className="w-full bg-[#FAFAF7] rounded-[32px] p-6 lg:p-8 border shadow-xl overflow-hidden font-sans relative perspective-1000"
			style={{ borderColor: "rgba(221, 208, 188, 0.6)" }}
		>
			<div className="flex justify-between items-center mb-8 relative z-10">
				<div>
					<h3 className="text-xl font-bold text-[#2A3A2C] flex items-center gap-2">
						<Target className="text-[#C2410C]" /> Research Cohorts
					</h3>
					<div className="text-sm text-gray-500 mt-1">
						Content Gap to Published Workflow
					</div>
				</div>
			</div>

			{/* Kanban Board Mock */}
			<div className="flex flex-col md:flex-row gap-4 relative">
				{/* Column 1: Gap Identified */}
				<div
					className="flex-1 bg-white rounded-2xl border p-4 shadow-sm"
					style={{ borderColor: "rgba(221, 208, 188, 0.4)" }}
				>
					<div className="text-xs font-bold text-gray-500 mb-4 flex items-center justify-between">
						<span>GAP IDENTIFIED</span>
						<span className="bg-gray-100 px-2 py-0.5 rounded-full text-[10px]">
							2
						</span>
					</div>

					<div className="space-y-3 relative h-[250px]">
						{/* Static Card */}
						<div className="bg-[#FDFCF8] border border-gray-200 p-3 rounded-xl shadow-sm opacity-50">
							<div className="text-sm font-bold text-gray-700">
								Vue.js Integration
							</div>
							<div className="text-[10px] text-red-500 font-bold mt-2">
								-40% vs amcharts
							</div>
						</div>

						{/* Moving Card */}
						<motion.div
							initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
							whileInView={{
								x: [0, 10, 10, "108%", "108%", "216%", "216%"],
								y: [0, 0, -20, -20, 0, 0, 40],
								scale: [1, 1.05, 1.05, 1.05, 1, 1, 1],
							}}
							transition={{
								duration: 4,
								times: [0, 0.1, 0.2, 0.4, 0.5, 0.8, 1],
								repeat: Infinity,
								repeatDelay: 2,
							}}
							className="bg-white border-2 border-[#C2410C] p-4 rounded-xl shadow-lg absolute z-20 w-full cursor-grab"
						>
							<div className="flex justify-between items-start mb-2">
								<div className="text-sm font-bold text-[#1F2937]">
									D3.js vs Highcharts performance
								</div>
								<div className="bg-red-100 text-red-700 p-1 rounded">
									<Target size={12} />
								</div>
							</div>
							<div className="flex gap-1 mb-3">
								<span className="text-[9px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
									big-data
								</span>
								<span className="text-[9px] font-bold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
									comparison
								</span>
							</div>
							<div className="text-xs text-gray-500 flex items-center gap-1">
								<BarChart2 size={12} /> Target: +15pp
							</div>
						</motion.div>
					</div>
				</div>

				{/* Column 2: In Progress (AI Brief) */}
				<div
					className="flex-1 bg-white rounded-2xl border p-4 shadow-sm relative overflow-hidden"
					style={{ borderColor: "rgba(221, 208, 188, 0.4)" }}
				>
					<div className="text-xs font-bold text-[#3B82F6] mb-4 flex items-center justify-between">
						<span className="flex items-center gap-1">
							<Sparkles size={12} /> AI BRIEF GENERATED
						</span>
					</div>

					<div className="space-y-3 relative h-[250px] flex flex-col items-center justify-center">
						{/* Empty state wireframe for when card isn't here */}
						<div className="w-full text-center border-2 border-dashed border-blue-100 rounded-xl p-8 opacity-50">
							<FileText size={24} className="text-blue-200 mx-auto mb-2" />
							<div className="text-xs font-bold text-blue-300">
								Drop here to auto-generate brief
							</div>
						</div>
					</div>
				</div>

				{/* Column 3: Published & Verified */}
				<div className="flex-1 bg-[#F2F9F4] rounded-2xl border border-[#CDE2D0] p-4 shadow-sm">
					<div className="text-xs font-bold text-[#166534] mb-4 flex items-center justify-between">
						<span className="flex items-center gap-1">
							<CheckSquare size={12} /> VERIFIED BY LLM
						</span>
						<span className="bg-green-200 text-green-800 px-2 py-0.5 rounded-full text-[10px]">
							12
						</span>
					</div>

					<div className="space-y-3 h-[250px]">
						<div className="bg-white border border-green-200 p-3 rounded-xl shadow-[0_2px_10px_rgba(22,101,52,0.1)]">
							<div className="text-sm font-bold text-green-900 line-through decoration-green-300">
								React Accessibility Guide
							</div>
							<div className="text-[10px] text-green-600 font-bold mt-2 flex items-center gap-1">
								<Activity size={10} /> +22% Uplift Confirmed
							</div>
						</div>
					</div>
				</div>

				{/* Connecting Arrows hidden on mobile */}
				<div className="hidden md:block absolute top-[120px] left-[31%] text-gray-300 transform -translate-y-1/2 z-10">
					<ArrowRight size={24} />
				</div>
				<div className="hidden md:block absolute top-[120px] left-[66%] text-gray-300 transform -translate-y-1/2 z-10">
					<ArrowRight size={24} />
				</div>
			</div>
		</div>
	);
}

function BarChart2({ size }: { size: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<line x1="18" y1="20" x2="18" y2="10"></line>
			<line x1="12" y1="20" x2="12" y2="4"></line>
			<line x1="6" y1="20" x2="6" y2="14"></line>
		</svg>
	);
}
