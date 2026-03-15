/* biome-ignore-all lint/suspicious/noArrayIndexKey: display-only mapped lists in this file */
/* biome-ignore-all lint/a11y/noSvgWithoutTitle: decorative inline icons */
import { motion } from "framer-motion";
import { Activity, Clock, Cpu, DollarSign, Server } from "lucide-react";

export default function PerformanceAnalyticsFeature() {
	return (
		<div
			className="w-full bg-white rounded-[32px] p-6 lg:p-8 border shadow-xl overflow-hidden font-sans relative perspective-1000"
			style={{ borderColor: "rgba(221, 208, 188, 0.6)" }}
		>
			<div className="flex justify-between items-center mb-8 relative z-10">
				<div>
					<h3 className="text-xl font-bold text-[#2A3A2C] flex items-center gap-2">
						<Server className="text-gray-400" /> Cost & Performance
					</h3>
					<div className="text-sm text-gray-500 mt-1">
						Under the hood analytics
					</div>
				</div>
				<div className="flex gap-2">
					<div
						className="bg-[#F9F8F6] rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-500 shadow-sm flex items-center gap-1"
						style={{ borderColor: "rgba(221, 208, 188, 0.4)" }}
					>
						<Clock size={14} /> Last 7 Days
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
				{/* Cost Estimate Ticker */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true }}
					className="col-span-1 border rounded-2xl p-5 bg-[#F9F8F6]"
					style={{ borderColor: "rgba(221, 208, 188, 0.3)" }}
				>
					<div className="flex items-center gap-2 text-xs font-bold text-gray-400 tracking-wider mb-4">
						<DollarSign size={14} className="text-[#558A5E]" /> EST. RUN COST
					</div>
					<div className="text-4xl font-black text-[#2A3A2C] font-mono tracking-tighter flex items-center gap-1 mb-2">
						<span className="text-gray-300">$</span>
						<motion.div
							initial={{ translateY: 20, opacity: 0 }}
							whileInView={{ translateY: 0, opacity: 1 }}
							transition={{ delay: 0.3, type: "spring" }}
						>
							14.28
						</motion.div>
					</div>
					<div className="text-xs text-gray-500 font-medium pb-2 border-b border-gray-200">
						Across 1,240 prompts
					</div>

					<div className="mt-4 space-y-2">
						<div className="flex justify-between text-xs">
							<span className="text-gray-500 font-medium">GPT-4o</span>
							<span className="font-mono text-gray-700 font-bold">$9.42</span>
						</div>
						<div className="flex justify-between text-xs">
							<span className="text-gray-500 font-medium">
								Claude 3.5 Sonnet
							</span>
							<span className="font-mono text-gray-700 font-bold">$4.86</span>
						</div>
					</div>
				</motion.div>

				{/* Latency Dial */}
				<motion.div
					initial={{ opacity: 0, scale: 0.95 }}
					whileInView={{ opacity: 1, scale: 1 }}
					viewport={{ once: true }}
					transition={{ delay: 0.2 }}
					className="col-span-1 border rounded-2xl p-5 bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)] flex flex-col items-center justify-center relative overflow-hidden group"
					style={{ borderColor: "rgba(221, 208, 188, 0.5)" }}
				>
					<div className="absolute inset-0 bg-gradient-to-b from-transparent to-red-50 opacity-0 group-hover:opacity-100 transition-opacity" />

					<div className="text-xs font-bold text-gray-400 tracking-wider mb-6 w-full flex items-center gap-2">
						<Activity size={14} className="text-[#D18880]" /> p95 LATENCY
					</div>

					<div className="relative w-32 h-16 overflow-hidden flex justify-center mb-2">
						<svg
							className="absolute w-32 h-32"
							viewBox="0 0 100 50"
							preserveAspectRatio="none"
						>
							<path
								d="M 10 50 A 40 40 0 0 1 90 50"
								fill="none"
								stroke="#F3F4F6"
								strokeWidth="8"
								strokeLinecap="round"
							/>
							<motion.path
								initial={{ pathLength: 0 }}
								whileInView={{ pathLength: 0.75 }}
								transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
								d="M 10 50 A 40 40 0 0 1 90 50"
								fill="none"
								stroke="url(#latencyGradient)"
								strokeWidth="8"
								strokeLinecap="round"
							/>
							<defs>
								<linearGradient
									id="latencyGradient"
									x1="0"
									y1="0"
									x2="1"
									y2="0"
								>
									<stop offset="0%" stopColor="#558A5E" />
									<stop offset="50%" stopColor="#D6A15C" />
									<stop offset="100%" stopColor="#D18880" />
								</linearGradient>
							</defs>
						</svg>

						{/* Needle */}
						<motion.div
							initial={{ rotate: -90 }}
							whileInView={{ rotate: 30 }}
							transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
							className="absolute bottom-[-4px] w-1 h-16 origin-bottom z-10"
						>
							<div className="w-1 h-8 bg-gray-800 rounded-full mx-auto shadow-md" />
							<div className="w-2.5 h-2.5 rounded-full bg-gray-800 border-2 border-white absolute -bottom-1 -left-[3px] shadow-sm" />
						</motion.div>
					</div>

					<div className="text-2xl font-black text-[#2A3A2C] mt-2 font-mono">
						15.4s
					</div>
					<div className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold mt-1 shadow-sm">
						Web Search Impact
					</div>
				</motion.div>

				{/* Token Counters */}
				<motion.div
					initial={{ opacity: 0, x: 20 }}
					whileInView={{ opacity: 1, x: 0 }}
					viewport={{ once: true }}
					transition={{ delay: 0.4 }}
					className="col-span-1 border rounded-2xl p-5 bg-[#F9F8F6]"
					style={{ borderColor: "rgba(221, 208, 188, 0.3)" }}
				>
					<div className="flex items-center gap-2 text-xs font-bold text-gray-400 tracking-wider mb-4">
						<Cpu size={14} className="text-[#A894B4]" /> TOKEN USAGE
					</div>

					<div className="space-y-4">
						{[
							{ label: "GPT-4o Input", val: "1.2M", color: "bg-green-500" },
							{ label: "GPT-4o Output", val: "450K", color: "bg-green-400" },
							{ label: "Claude Input", val: "800K", color: "bg-amber-500" },
							{ label: "Claude Output", val: "320K", color: "bg-amber-400" },
						].map((stat, i) => (
							<div key={i} className="flex flex-col gap-1">
								<div className="flex justify-between items-end text-xs font-semibold">
									<span className="text-gray-500">{stat.label}</span>
									<span className="font-mono text-gray-800">{stat.val}</span>
								</div>
								<div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
									<motion.div
										initial={{ width: 0 }}
										whileInView={{ width: `${Math.random() * 50 + 40}%` }}
										transition={{ duration: 1, delay: 0.8 + i * 0.1 }}
										className={`h-full rounded-full ${stat.color}`}
									/>
								</div>
							</div>
						))}
					</div>
				</motion.div>
			</div>
		</div>
	);
}
