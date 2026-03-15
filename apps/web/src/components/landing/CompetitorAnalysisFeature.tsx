/* biome-ignore-all lint/suspicious/noArrayIndexKey: display-only mapped lists in this file */
import { AnimatePresence, motion } from "framer-motion";
import {
	Activity,
	BarChart2,
	LayoutTemplate,
	PieChart,
	Search,
	Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

// Helper component for animated numbers
function AnimatedNumber({
	value,
	suffix = "",
	prefix = "",
	decimals = 0,
}: {
	value: number;
	suffix?: string;
	prefix?: string;
	decimals?: number;
}) {
	const [val, setVal] = useState(0);
	useEffect(() => {
		const start = 0;
		const end = value;
		const duration = 1500;
		let startTimestamp: number | null = null;
		const step = (timestamp: number) => {
			if (!startTimestamp) startTimestamp = timestamp;
			const progress = Math.min((timestamp - startTimestamp) / duration, 1);
			const easeProgress = 1 - (1 - progress) ** 4;
			setVal(easeProgress * (end - start));
			if (progress < 1) window.requestAnimationFrame(step);
			else setVal(value);
		};
		window.requestAnimationFrame(step);
	}, [value]);
	return (
		<>
			{prefix}
			{val.toFixed(decimals)}
			{suffix}
		</>
	);
}

export default function CompetitorAnalysisFeature() {
	return (
		<div
			className="w-full bg-[#FAFAF7] rounded-[32px] p-6 lg:p-8 border shadow-xl overflow-hidden font-sans relative perspective-1000"
			style={{ borderColor: "rgba(221, 208, 188, 0.6)" }}
		>
			<div className="flex justify-between items-center mb-6">
				<h3 className="text-xl font-bold text-[#2A3A2C]">
					Competitor Analysis
				</h3>
				<div className="flex gap-2">
					<div
						className="bg-white rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm flex items-center gap-1 cursor-pointer hover:bg-gray-50 transition-colors"
						style={{ borderColor: "rgba(221, 208, 188, 0.4)" }}
					>
						<LayoutTemplate size={14} /> Tag: DataViz
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* Share of Voice Pie Mock */}
				<motion.div
					initial={{ opacity: 0, scale: 0.95 }}
					whileInView={{ opacity: 1, scale: 1 }}
					viewport={{ once: true }}
					className="bg-white rounded-2xl p-6 border shadow-sm flex flex-col items-center justify-center relative overflow-hidden"
					style={{ borderColor: "rgba(221, 208, 188, 0.4)" }}
				>
					<div className="absolute top-4 left-4 text-xs font-bold text-gray-400 tracking-wider">
						SHARE OF VOICE
					</div>
					<div className="absolute top-4 right-4">
						<PieChart size={18} className="text-gray-300" />
					</div>

					<div className="relative w-48 h-48 mt-4 flex items-center justify-center">
						{/* CSS-based animated Pie Chart mock using conic-gradient */}
						<motion.div
							initial={{ rotate: -90, scale: 0.5, opacity: 0 }}
							whileInView={{ rotate: 0, scale: 1, opacity: 1 }}
							transition={{ duration: 1.5, type: "spring", bounce: 0.4 }}
							className="absolute inset-0 rounded-full"
							style={{
								background:
									"conic-gradient(#558A5E 0% 38%, #D6A15C 38% 68%, #A894B4 68% 88%, #D18880 88% 100%)",
								boxShadow:
									"inset 0 0 0 4px white, inset 0 0 20px rgba(0,0,0,0.1), 0 10px 20px rgba(0,0,0,0.05)",
							}}
						/>
						{/* Inner cutout for donut shape */}
						<div className="absolute inset-0 m-auto w-32 h-32 bg-white rounded-full shadow-inner flex flex-col items-center justify-center z-10">
							<motion.div
								initial={{ opacity: 0 }}
								whileInView={{ opacity: 1 }}
								transition={{ delay: 1 }}
								className="text-3xl font-black text-[#558A5E]"
							>
								38%
							</motion.div>
							<div className="text-[10px] text-gray-500 font-bold uppercase">
								Highcharts
							</div>
						</div>

						{/* Floating Labels */}
						<motion.div
							initial={{ opacity: 0, x: -20 }}
							whileInView={{ opacity: 1, x: 0 }}
							transition={{ delay: 1.2 }}
							className="absolute -left-12 top-10 bg-white shadow-md border px-2 py-1 rounded text-xs font-bold text-[#558A5E] z-20 tooltip"
						>
							Highcharts
						</motion.div>
						<motion.div
							initial={{ opacity: 0, x: 20 }}
							whileInView={{ opacity: 1, x: 0 }}
							transition={{ delay: 1.3 }}
							className="absolute -right-8 top-10 bg-white shadow-md border px-2 py-1 rounded text-xs font-bold text-[#D6A15C] z-20 tooltip"
						>
							d3.js
						</motion.div>
					</div>

					<div className="flex gap-4 mt-8 text-xs font-medium text-gray-500">
						<div className="flex items-center gap-1.5">
							<div className="w-2.5 h-2.5 rounded bg-[#558A5E]" /> You
						</div>
						<div className="flex items-center gap-1.5">
							<div className="w-2.5 h-2.5 rounded bg-[#D6A15C]" /> D3
						</div>
						<div className="flex items-center gap-1.5">
							<div className="w-2.5 h-2.5 rounded bg-[#A894B4]" /> Chart.js
						</div>
					</div>
				</motion.div>

				{/* Head-to-Head Gap Column */}
				<motion.div
					initial={{ opacity: 0, x: 20 }}
					whileInView={{ opacity: 1, x: 0 }}
					viewport={{ once: true }}
					className="bg-white rounded-2xl p-6 border shadow-sm relative col-span-1"
					style={{ borderColor: "rgba(221, 208, 188, 0.4)" }}
				>
					<div className="absolute top-4 left-4 text-xs font-bold text-gray-400 tracking-wider">
						HEAD-TO-HEAD GAP
					</div>
					<div className="absolute top-4 right-4">
						<Zap size={18} className="text-gray-300" />
					</div>

					<div className="mt-8 space-y-5">
						{[
							{
								name: "vs d3.js",
								value: "-26.9%",
								color: "text-red-500",
								barBg: "bg-red-500",
								width: "60%",
								lead: false,
							},
							{
								name: "vs chart.js",
								value: "-8.3%",
								color: "text-red-400",
								barBg: "bg-red-400",
								width: "25%",
								lead: false,
							},
							{
								name: "vs echarts",
								value: "-6.5%",
								color: "text-red-400",
								barBg: "bg-red-400",
								width: "20%",
								lead: false,
							},
							{
								name: "vs Recharts",
								value: "+27.2%",
								color: "text-green-600",
								barBg: "bg-green-500",
								width: "65%",
								lead: true,
							},
							{
								name: "vs amcharts",
								value: "+55.6%",
								color: "text-green-600",
								barBg: "bg-green-500",
								width: "90%",
								lead: true,
							},
						].map((gap, i) => (
							<div
								key={i}
								className="flex items-center justify-between text-sm"
							>
								<div className="w-24 font-medium text-gray-600 truncate">
									{gap.name}
								</div>
								<div className="flex-1 px-4 max-w-[150px] relative h-2">
									{/* Center line */}
									<div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-200" />
									<motion.div
										initial={{ width: 0 }}
										whileInView={{ width: gap.width }}
										transition={{
											duration: 1,
											delay: 0.2 + i * 0.1,
											ease: "easeOut",
										}}
										className={`h-full rounded-full absolute top-0 ${gap.barBg} ${gap.lead ? "left-1/2" : "right-1/2 origin-right"}`}
										style={gap.lead ? {} : { transformOrigin: "right" }}
									/>
								</div>
								<div className={`w-16 text-right font-bold ${gap.color}`}>
									{gap.value}
								</div>
							</div>
						))}
					</div>
				</motion.div>
			</div>
		</div>
	);
}
