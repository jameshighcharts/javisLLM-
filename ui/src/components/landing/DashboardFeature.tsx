import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Activity, BarChart3, Bot, Search, Target, TrendingUp, CheckCircle2 } from 'lucide-react'

// Helper component for animated numbers
function AnimatedNumber({ value, suffix = '', prefix = '', decimals = 0 }: { value: number, suffix?: string, prefix?: string, decimals?: number }) {
    const [val, setVal] = useState(0)

    useEffect(() => {
        let start = 0
        const end = value
        const duration = 2000 // 2s
        let startTimestamp: number | null = null

        const step = (timestamp: number) => {
            if (!startTimestamp) startTimestamp = timestamp
            const progress = Math.min((timestamp - startTimestamp) / duration, 1)
            const easeProgress = 1 - Math.pow(1 - progress, 4) // easeOutQuart
            setVal((easeProgress * (end - start)))

            if (progress < 1) {
                window.requestAnimationFrame(step)
            } else {
                setVal(value)
            }
        }

        window.requestAnimationFrame(step)
    }, [value])

    return <>{prefix}{val.toFixed(decimals)}{suffix}</>
}

export default function DashboardFeature() {
    return (
        <div className="w-full bg-[#FAFAF7] rounded-[32px] p-6 lg:p-8 border shadow-xl overflow-hidden font-sans relative perspective-1000" style={{ borderColor: 'rgba(221, 208, 188, 0.6)' }}>

            {/* Mock Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <h3 className="text-xl font-bold text-[#2A3A2C]">Dashboard</h3>
                <div className="bg-white rounded-xl border px-4 py-2 text-sm font-medium text-gray-600 shadow-sm flex items-center gap-2" style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}>
                    Segment by Tags & Model <span className="text-gray-400">| 128 prompts · all providers</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">

                {/* AI Visibility Score Widget */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="bg-white rounded-2xl p-6 border shadow-sm relative overflow-hidden"
                    style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
                >
                    <div className="flex justify-between items-start mb-2">
                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">AI Visibility Score</div>
                        <div className="w-4 h-4 rounded-full border border-gray-300 flex items-center justify-center text-[10px] text-gray-400">i</div>
                    </div>

                    <div className="flex items-baseline gap-2 mb-8">
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            whileInView={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
                            className="text-5xl font-black text-[#15803D] tracking-tighter"
                        >
                            <AnimatedNumber value={47.8} decimals={1} />
                        </motion.div>
                        <div className="text-gray-400 font-medium">/ 100</div>
                        <motion.div
                            initial={{ opacity: 0, x: -10 }}
                            whileInView={{ opacity: 1, x: 0 }}
                            transition={{ delay: 1 }}
                            className="ml-2 px-2 py-0.5 bg-[#DCFCE7] text-[#166534] text-xs font-bold rounded-full"
                        >
                            On target
                        </motion.div>
                    </div>

                    {/* Gradient Bar */}
                    <div className="relative h-3 w-full rounded-full bg-gradient-to-r from-red-400 via-yellow-400 to-green-500 overflow-hidden">
                        {/* Marker */}
                        <motion.div
                            initial={{ left: '0%' }}
                            whileInView={{ left: '47.8%' }}
                            transition={{ duration: 1.5, ease: "easeOut", delay: 0.5 }}
                            className="absolute top-0 bottom-0 w-1 bg-white shadow-sm border-x border-gray-200"
                        />
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
                        <span>0</span>
                        <span>25</span>
                        <span className="relative">
                            <span className="absolute -top-6 -left-3 text-[10px] bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">Goal</span>
                            50
                        </span>
                        <span>75</span>
                        <span>100</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-3 font-medium">70% presence · 30% share of voice</div>
                </motion.div>

                {/* Score Over Time Widget */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 }}
                    className="bg-white rounded-2xl p-6 border shadow-sm relative col-span-1"
                    style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
                >
                    <div className="flex justify-between items-start mb-4">
                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">AI Visibility Score Over Time</div>
                        <div className="w-4 h-4 rounded-full border border-gray-300 flex items-center justify-center text-[10px] text-gray-400">i</div>
                    </div>

                    <div className="flex gap-8 mb-6">
                        <div>
                            <div className="text-[10px] font-bold text-gray-400 uppercase">AI Visibility</div>
                            <div className="text-2xl font-bold text-[#558A5E] flex items-center gap-2">
                                47.8 <span className="text-xs text-red-500 flex items-center">▼ 5.6</span>
                            </div>
                        </div>
                        <div>
                            <div className="text-[10px] font-bold text-gray-400 uppercase">COMBVI</div>
                            <div className="text-2xl font-bold text-[#D6A15C] flex items-center gap-2">
                                38.9 <span className="text-xs text-green-500 flex items-center">▲ 0.5</span>
                            </div>
                        </div>
                    </div>

                    {/* Minimal SVG Chart */}
                    <div className="h-16 w-full relative">
                        <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                            {/* COMBVI line (dashed) */}
                            <motion.path
                                initial={{ pathLength: 0 }}
                                whileInView={{ pathLength: 1 }}
                                transition={{ duration: 1.5, ease: "easeInOut" }}
                                d="M0 60 Q 25 65 50 62 T 100 65"
                                fill="none" stroke="#D6A15C" strokeWidth="2" strokeDasharray="4 4"
                            />
                            {/* AI Visibility Line (Solid) */}
                            <motion.path
                                initial={{ pathLength: 0 }}
                                whileInView={{ pathLength: 1 }}
                                transition={{ duration: 1.5, ease: "easeInOut", delay: 0.2 }}
                                d="M0 45 Q 25 35 50 15 T 100 65"
                                fill="none" stroke="#558A5E" strokeWidth="2.5"
                            />
                        </svg>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-2">AI Visibility + COMBVI snapshots · run history</div>
                </motion.div>

                {/* Sub-widgets side-by-side inside grid */}
                <div className="grid grid-cols-2 gap-4 col-span-1">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.2 }}
                        className="bg-white rounded-2xl p-5 border shadow-sm flex flex-col justify-center items-center text-center"
                        style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
                    >
                        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Prompts Tracked</div>
                        <motion.div
                            initial={{ scale: 0 }}
                            whileInView={{ scale: 1 }}
                            transition={{ type: "spring", delay: 0.5 }}
                            className="text-5xl font-black text-[#1a2520] my-2"
                        >
                            <AnimatedNumber value={122} />
                        </motion.div>
                        <div className="text-[10px] font-bold text-[#558A5E] uppercase tracking-widest mt-1">Active Queries</div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3 }}
                        className="bg-white rounded-2xl p-5 border shadow-sm flex flex-col justify-between"
                        style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
                    >
                        <div className="flex justify-between items-center">
                            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Prompts</div>
                            <div className="p-1.5 bg-[#EFF6F0] rounded-lg text-[#558A5E]"><Search size={14} /></div>
                        </div>
                        <div className="text-sm font-bold text-[#2A3A2C] mt-2 mb-4">Manage Queries</div>
                        <div className="flex justify-end mt-auto text-gray-300">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>
                        </div>
                        <div className="text-xs font-bold text-[#558A5E] mt-2">Open Prompts →</div>
                    </motion.div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

                {/* Large Chart LHS */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.4 }}
                    className="bg-white rounded-2xl p-6 border shadow-sm col-span-3 flex flex-col relative"
                    style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
                >
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h4 className="text-lg font-bold text-[#2A3A2C]">LLM Mention Rate Over Time</h4>
                            <div className="text-sm text-gray-500">% of responses that mention each brand across runs</div>
                        </div>
                        <div className="text-right">
                            <div className="text-3xl font-black text-[#2A3A2C]"><AnimatedNumber value={61.5} decimals={1} suffix="%" /></div>
                            <div className="text-xs text-gray-400 font-medium">mention rate</div>
                        </div>
                    </div>

                    <div className="flex-1 min-h-[200px] relative w-full border-b border-l border-gray-100 mb-6">
                        {/* SVG lines mimicking multiline chart */}
                        <svg className="w-full h-full absolute inset-0 preserve-3d" preserveAspectRatio="none" viewBox="0 0 100 100">
                            {/* BG Fill for Highcharts */}
                            <motion.path initial={{ opacity: 0 }} whileInView={{ opacity: 0.05 }} transition={{ delay: 1 }} d="M 0 50 Q 50 30 100 40 L 100 100 L 0 100 Z" fill="#558A5E" />

                            {[
                                { d: "M 0 5 Q 50 1 100 15", color: "#D6A15C", delay: 0.1, strokeDasharray: "2 2" }, // D3
                                { d: "M 0 25 Q 40 10 100 30", color: "#A894B4", delay: 0.2 }, // Chartjs
                                { d: "M 0 30 Q 60 30 100 35", color: "#D18880", delay: 0.3, strokeDasharray: "2 2" }, // Echarts
                                { d: "M 0 50 Q 50 30 100 40", color: "#558A5E", delay: 0.5, strokeWidth: 3 }, // Highcharts
                            ].map((line, i) => (
                                <motion.path
                                    key={i}
                                    initial={{ pathLength: 0 }}
                                    whileInView={{ pathLength: 1 }}
                                    viewport={{ once: true }}
                                    transition={{ duration: 2, ease: "easeOut", delay: line.delay }}
                                    d={line.d}
                                    fill="none"
                                    stroke={line.color}
                                    strokeWidth={line.strokeWidth || 1.5}
                                    strokeDasharray={line.strokeDasharray}
                                />
                            ))}
                        </svg>
                        {/* Y Axis markings */}
                        <div className="absolute left-[-30px] top-0 bottom-0 flex flex-col justify-between text-[10px] text-gray-400 font-medium">
                            <span>100%</span>
                            <span>75%</span>
                            <span>50%</span>
                            <span>25%</span>
                            <span>0%</span>
                        </div>
                        {/* X Axis markings */}
                        <div className="absolute left-0 right-0 -bottom-6 flex justify-around text-[10px] text-gray-400 font-medium">
                            <span>Feb 26</span>
                            <span>Feb 26</span>
                            <span>Feb 26</span>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-4">
                        <div className="px-3 py-1 rounded-full text-xs font-bold border border-[#558A5E] text-[#558A5E] bg-[#F2F9F4]">Highcharts only</div>
                        <div className="px-3 py-1 rounded-full text-xs font-bold text-gray-500 bg-gray-100">Show all</div>
                        {/* Legend Pills */}
                        <div className="px-3 py-1 rounded-full text-[10px] font-bold text-white bg-[#D6A15C] flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-white" />d3.js</div>
                        <div className="px-3 py-1 rounded-full text-[10px] font-bold text-white bg-[#558A5E] flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-white" />Highcharts</div>
                        <div className="px-3 py-1 rounded-full text-[10px] font-bold text-white bg-[#A894B4] flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-white" />chart.js</div>
                        <div className="px-3 py-1 rounded-full text-[10px] font-bold text-white bg-[#D18880] flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-white" />echarts</div>
                    </div>
                </motion.div>

                {/* Competitor Ranking RHS */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.5 }}
                    className="bg-white rounded-2xl p-6 border shadow-sm col-span-2 relative overflow-hidden flex flex-col"
                    style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
                >
                    <div className="mb-4">
                        <h4 className="text-[15px] font-bold text-[#2A3A2C]">Competitor Ranking</h4>
                        <div className="text-[11px] text-gray-500">Sorted by mention rate - bar = relative share</div>
                    </div>

                    <div className="flex-1 flex flex-col justify-between space-y-3 relative z-10 w-full">
                        {[
                            { rank: 1, name: "d3.js", score: 88.4, sov: 26, color: "#D6A15C", iconColor: "text-orange-500" },
                            { rank: 2, name: "chart.js", score: 69.8, sov: 21, color: "#A894B4", iconColor: "text-purple-400" },
                            { rank: 3, name: "echarts", score: 68.0, sov: 20, color: "#D18880", iconColor: "text-red-400" },
                            { rank: 4, name: "Highcharts", score: 61.5, sov: 18, color: "#558A5E", active: true, iconColor: "text-[#558A5E]" },
                            { rank: 5, name: "Recharts", score: 34.3, sov: 10, color: "#8CB8A3", iconColor: "text-teal-400" },
                            { rank: 6, name: "amcharts", score: 5.9, sov: 2, color: "#A1C2D8", iconColor: "text-blue-300" },
                            { rank: 7, name: "AG Grid", score: 4.6, sov: 1, color: "#E09A90", iconColor: "text-red-300" },
                        ].map((comp, idx) => (
                            <div key={comp.name} className={`flex items-center gap-3 w-full text-xs font-semibold ${comp.active ? 'bg-[#F2F9F4] p-2 -mx-2 rounded-xl border border-[#CDE2D0]' : 'py-1'}`}>
                                <div className="w-4 text-center text-gray-400">{comp.rank}</div>
                                <div className={`w-4 h-4 rounded-sm flex items-center justify-center ${comp.active ? '' : 'opacity-80'}`}>
                                    {/* Mock small icon */}
                                    <div className={`w-2.5 h-2.5 rounded-[3px] bg-current opacity-80 ${comp.iconColor}`}></div>
                                </div>
                                <div className={`w-20 truncate ${comp.active ? 'text-[#2A3A2C]' : 'text-gray-600'}`}>{comp.name}</div>

                                <div className="flex-1 px-2 relative h-1.5 bg-gray-100 rounded-full overflow-hidden flex items-center">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        whileInView={{ width: `${comp.score}%` }}
                                        viewport={{ once: true }}
                                        transition={{ duration: 1, delay: 0.5 + (idx * 0.1), ease: "easeOut" }}
                                        className="h-full rounded-full"
                                        style={{ background: comp.color, opacity: comp.active ? 1 : 0.6 }}
                                    />
                                </div>

                                <div className="text-right w-16">
                                    <div className={`font-bold ${comp.active ? 'text-[#2A3A2C]' : 'text-gray-700'}`}>{comp.score}%</div>
                                    <div className="text-[9px] text-gray-400 leading-none">{comp.sov}% SOV</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>

            </div>

        </div>
    )
}
