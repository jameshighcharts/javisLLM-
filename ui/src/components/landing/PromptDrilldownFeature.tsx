import { motion } from 'framer-motion'
import { Layers, ChevronDown, BarChart2, Activity } from 'lucide-react'

export default function PromptDrilldownFeature() {
    return (
        <div className="w-full bg-white rounded-[32px] p-6 lg:p-8 border shadow-xl overflow-hidden font-sans relative perspective-1000" style={{ borderColor: 'rgba(221, 208, 188, 0.6)' }}>

            <div className="flex justify-between items-center mb-8 relative z-10">
                <div>
                    <h3 className="text-xl font-bold text-[#2A3A2C] flex items-center gap-2">
                        <Layers className="text-[#A894B4]" /> Prompt Drilldown
                    </h3>
                    <div className="text-sm text-gray-500 mt-1">From aggregate to atomic level</div>
                </div>
            </div>

            {/* Mock Table Context */}
            <div className="rounded-2xl border bg-gray-50/50 mb-6 relative" style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}>
                <div className="px-6 py-3 border-b border-gray-100 flex text-xs font-bold text-gray-400 tracking-wider">
                    <div className="flex-1">QUERY</div>
                    <div className="w-24 text-right">MENTION RATE</div>
                </div>

                {/* Collapsed Row */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center text-sm text-gray-400 bg-white opacity-50">
                    <div className="flex-1 font-medium">How do I create interactive charts in Angular?</div>
                    <div className="w-24 text-right">32.4%</div>
                </div>

                {/* Expanded Focus Row */}
                <motion.div
                    initial={{ height: 60 }}
                    whileInView={{ height: 'auto' }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.8, ease: "anticipate" }}
                    className="bg-white overflow-hidden shadow-[0_10px_30px_rgba(0,0,0,0.05)] border-y-2 border-[#A894B4] relative z-10"
                >
                    <div className="px-6 py-4 flex items-center cursor-pointer bg-purple-50/30">
                        <div className="flex-1 font-bold text-[#1F2937] text-base">Best javascript libraries for financial charting</div>
                        <div className="w-24 text-right font-black text-[#A894B4] text-lg">85.2%</div>
                        <ChevronDown size={20} className="ml-4 text-gray-400 rotate-180 transition-transform" />
                    </div>

                    {/* Drilldown Content */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="p-6 bg-white border-t border-gray-100 grid grid-cols-1 lg:grid-cols-3 gap-8"
                    >
                        {/* Per-Prompt Trend */}
                        <div className="col-span-2 space-y-4">
                            <div className="text-xs font-bold text-gray-500 flex items-center gap-1"><Activity size={14} /> ISOLATED TREND</div>
                            <div className="h-40 w-full relative border-b border-l border-gray-100">
                                {/* SVG Line chart */}
                                <svg className="w-full h-full absolute inset-0" preserveAspectRatio="none" viewBox="0 0 100 100">
                                    {/* Fill */}
                                    <motion.path
                                        initial={{ opacity: 0 }}
                                        whileInView={{ opacity: 0.1 }}
                                        transition={{ delay: 1 }}
                                        d="M 0 60 Q 30 80 60 40 T 100 20 L 100 100 L 0 100 Z"
                                        fill="#A894B4"
                                    />
                                    {/* Line */}
                                    <motion.path
                                        initial={{ pathLength: 0 }}
                                        whileInView={{ pathLength: 1 }}
                                        transition={{ duration: 1.5, ease: "easeInOut", delay: 0.5 }}
                                        d="M 0 60 Q 30 80 60 40 T 100 20"
                                        fill="none" stroke="#A894B4" strokeWidth="3"
                                    />
                                    {/* Points */}
                                    {[
                                        { cx: 0, cy: 60, delay: 0.6 },
                                        { cx: 30, cy: 68, delay: 1.0 },
                                        { cx: 60, cy: 40, delay: 1.5 },
                                        { cx: 100, cy: 20, delay: 2.0 }
                                    ].map((pt, i) => (
                                        <motion.circle
                                            key={i}
                                            initial={{ scale: 0 }}
                                            whileInView={{ scale: 1 }}
                                            transition={{ delay: pt.delay }}
                                            cx={pt.cx} cy={pt.cy} r={pt.cx === 100 ? "4" : "3"}
                                            fill="white" stroke="#A894B4" strokeWidth="2"
                                        />
                                    ))}
                                </svg>
                                {/* Callout */}
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 2.2 }}
                                    className="absolute right-0 top-1 text-xs font-bold text-white bg-[#A894B4] px-2 py-1 rounded shadow-md"
                                >
                                    85.2%
                                </motion.div>
                            </div>
                        </div>

                        {/* Recent Raw Responses Log */}
                        <div className="col-span-1 border-l border-gray-100 pl-8 space-y-4">
                            <div className="text-xs font-bold text-gray-500">RAW RESPONSES (LATEST RUN)</div>
                            <div className="space-y-3">
                                {[
                                    { model: "GPT-4o", text: "...for financial data, Highcharts Stock is specifically designed...", match: true },
                                    { model: "Claude 3.5", text: "...D3.js offers flexibility, while Highcharts offers out-of-the-box...", match: true },
                                    { model: "Gemini", text: "...consider chart.js for simple needs or TradingView for...", match: false },
                                ].map((log, i) => (
                                    <div key={i} className="text-xs p-2.5 rounded-lg border bg-gray-50 hover:bg-white hover:shadow-sm transition-all cursor-pointer">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-bold text-gray-700">{log.model}</span>
                                            {log.match ?
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Mention Detected"></span> :
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-400" title="No Mention"></span>
                                            }
                                        </div>
                                        <div className="text-gray-500 italic line-clamp-2">"{log.text}"</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                    </motion.div>
                </motion.div>

                {/* Collapsed Row */}
                <div className="px-6 py-4 flex items-center text-sm text-gray-400 bg-white opacity-50 rounded-b-2xl">
                    <div className="flex-1 font-medium">Accessible data visualization tools</div>
                    <div className="w-24 text-right">41.8%</div>
                </div>
            </div>

        </div>
    )
}
