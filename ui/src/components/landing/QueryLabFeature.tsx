import { motion } from 'framer-motion'
import { Bot, Zap, Search, Globe, CheckCircle2 } from 'lucide-react'

export default function QueryLabFeature() {
    const text1 = "For enterprise data visualization in React, Highcharts is a premium choice known for robust SVG rendering and extensive charting types..."
    const text2 = "If you need an enterprise-grade solution, Highcharts provides excellent out-of-the-box React wrappers and top-tier accessibility support..."
    const text3 = "I recommend Highcharts for complex React dashboards. It handles large datasets efficiently and offers a wide variety of financial charts..."

    // A helper to render text with a typing effect and highlight "Highcharts"
    const TypingText = ({ text, delay }: { text: string, delay: number }) => {
        const words = text.split(" ")

        return (
            <div className="text-[13px] leading-relaxed text-gray-700 font-medium">
                {words.map((word, i) => {
                    const isHighlight = word.includes("Highcharts")
                    return (
                        <motion.span
                            key={i}
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.1, delay: delay + (i * 0.05) }}
                            className={isHighlight ? "bg-[#8FBB93]/30 text-[#2A3A2C] px-1 rounded border border-[#8FBB93]/50 font-bold mx-0.5" : "mr-1"}
                        >
                            {word}
                            {isHighlight && (
                                <motion.span
                                    initial={{ scale: 0 }}
                                    whileInView={{ scale: 1 }}
                                    transition={{ delay: delay + (i * 0.05) + 0.2, type: "spring" }}
                                    className="inline-block ml-1"
                                >
                                    <CheckCircle2 size={10} className="text-green-600 mb-0.5 inline" />
                                </motion.span>
                            )}
                        </motion.span>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="w-full bg-[#F3F4F6] rounded-[32px] p-6 lg:p-8 border shadow-xl overflow-hidden font-sans relative perspective-1000" style={{ borderColor: 'rgba(221, 208, 188, 0.6)' }}>

            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-bold text-[#1F2937] flex items-center gap-2">
                        <Bot className="text-[#3B82F6]" /> Query Lab
                    </h3>
                    <div className="text-sm text-gray-500 mt-1">Multi-model side-by-side comparison</div>
                </div>
                <div className="flex gap-2">
                    <div className="bg-white rounded-lg border px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm flex items-center gap-1">
                        <Globe size={14} className="text-blue-500" /> Web Search: ON
                    </div>
                </div>
            </div>

            {/* Prompt Input Bar Mock */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="bg-white rounded-2xl p-4 border shadow-sm flex items-center gap-4 mb-8"
                style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
            >
                <div className="bg-blue-50 p-2 rounded-xl"><Search size={20} className="text-blue-500" /></div>
                <div className="flex-1 text-lg font-medium text-gray-800">
                    What is the best enterprise charting library for React?
                </div>
                <button className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2 rounded-xl font-bold flex items-center gap-2 shadow-md">
                    <Zap size={16} /> Run All
                </button>
            </motion.div>

            {/* Side-by-Side Model Responses */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { model: "GPT-4o", time: "2.4s", txt: text1, delay: 0.5, color: "bg-green-100 text-green-700" },
                    { model: "Claude 3.5 Sonnet", time: "3.1s", txt: text2, delay: 1.0, color: "bg-amber-100 text-amber-700" },
                    { model: "Gemini 1.5 Pro", time: "2.8s", txt: text3, delay: 0.7, color: "bg-blue-100 text-blue-700" }
                ].map((res, i) => (
                    <motion.div
                        key={res.model}
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.2 + (i * 0.1) }}
                        className="bg-white rounded-2xl p-6 border shadow-[0_4px_20px_rgba(0,0,0,0.04)] relative group"
                        style={{ borderColor: 'rgba(221, 208, 188, 0.4)' }}
                    >
                        {/* Scanning beam effect */}
                        <motion.div
                            initial={{ top: 0, opacity: 0 }}
                            whileInView={{ top: '100%', opacity: [0, 0.5, 0] }}
                            transition={{ duration: 2, delay: res.delay, ease: "linear" }}
                            className="absolute left-0 right-0 h-2 bg-blue-400/20 blur-sm z-10 pointer-events-none"
                        />

                        <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-100">
                            <div className={`text-xs font-bold px-2.5 py-1 rounded-lg ${res.color} flex items-center gap-1.5`}>
                                <Bot size={12} /> {res.model}
                            </div>
                            <div className="text-[10px] font-mono text-gray-400 font-bold">{res.time}</div>
                        </div>

                        <div className="min-h-[120px]">
                            <TypingText text={res.txt} delay={res.delay} />
                        </div>

                        {/* Detection badges that pop in after typing */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            transition={{ delay: res.delay + 1.5 }}
                            className="mt-6 pt-4 border-t border-gray-50 flex gap-2"
                        >
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center">Detected:</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#8FBB93]/20 text-[#2E7D32]">Highcharts</span>
                        </motion.div>
                    </motion.div>
                ))}
            </div>

        </div>
    )
}
