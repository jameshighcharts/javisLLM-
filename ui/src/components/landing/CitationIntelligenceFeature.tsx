import { motion } from 'framer-motion'
import { Link2, Award, ShieldCheck, Globe, Info } from 'lucide-react'

export default function CitationIntelligenceFeature() {
    return (
        <div className="w-full bg-[#1A2520] rounded-[32px] p-6 lg:p-8 border shadow-xl overflow-hidden font-sans relative perspective-1000 text-white" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
            {/* Background Glows */}
            <div className="absolute top-[-50%] right-[-10%] w-[300px] h-[300px] bg-[#EAF2FF] rounded-full blur-[100px] opacity-10 pointer-events-none" />
            <div className="absolute bottom-[-50%] left-[-10%] w-[200px] h-[200px] bg-[#8FBB93] rounded-full blur-[80px] opacity-20 pointer-events-none" />

            <div className="flex justify-between items-center mb-8 relative z-10">
                <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Link2 className="text-[#8FBB93]" /> Citation Intelligence
                    </h3>
                    <div className="text-sm text-gray-400 mt-1">Discover which domains shape LLM answers</div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">

                {/* Leaderboard Mock */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm"
                >
                    <div className="flex items-center justify-between mb-5">
                        <div className="text-xs font-bold text-gray-400 tracking-wider">SOURCE LEADERBOARD</div>
                        <Award size={16} className="text-[#D6A15C]" />
                    </div>

                    <div className="space-y-4">
                        {[
                            { domain: 'highcharts.com', count: 1842, type: 'OWNED', typeColor: 'bg-green-500/20 text-green-400 border-green-500/30' },
                            { domain: 'github.com', count: 856, type: '3RD PARTY', typeColor: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
                            { domain: 'stackoverflow.com', count: 621, type: '3RD PARTY', typeColor: 'bg-gray-500/20 text-gray-300 border-gray-500/30' },
                            { domain: 'chartjs.org', count: 412, type: 'COMPETITOR', typeColor: 'bg-red-500/20 text-red-400 border-red-500/30' }
                        ].map((source, idx) => (
                            <motion.div
                                key={source.domain}
                                initial={{ opacity: 0, y: 10 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 + (idx * 0.1) }}
                                className="flex items-center justify-between p-3 rounded-xl bg-black/20 hover:bg-black/40 transition-colors border border-transparent hover:border-white/5"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-6 text-center text-sm font-bold text-gray-500">{idx + 1}</div>
                                    <div className="flex flex-col">
                                        <div className="font-medium text-gray-100 text-sm flex items-center gap-2">
                                            {source.domain}
                                            {idx === 0 && <ShieldCheck size={12} className="text-green-400" />}
                                        </div>
                                        <div className={`mt-1 text-[9px] font-bold px-1.5 py-0.5 rounded border inline-flex w-fit ${source.typeColor}`}>
                                            {source.type}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-lg font-bold text-[#8FBB93]">{source.count}</div>
                                    <div className="text-[10px] text-gray-500">CITATIONS</div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </motion.div>

                {/* Rich Citation Output Map */}
                <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm relative"
                >
                    <div className="text-xs font-bold text-gray-400 tracking-wider mb-5">CITATION CONTEXT</div>

                    {/* Animated Mock Lines connecting snippet to citation */}
                    <svg className="absolute inset-0 w-full h-full pointer-events-none -z-10" style={{ opacity: 0.3 }}>
                        <motion.path
                            initial={{ pathLength: 0 }}
                            whileInView={{ pathLength: 1 }}
                            transition={{ duration: 1, delay: 0.8 }}
                            d="M 120 120 Q 200 150 220 200"
                            fill="none" stroke="#8FBB93" strokeWidth="2" strokeDasharray="4 4"
                        />
                    </svg>

                    <div className="bg-black/30 rounded-xl p-4 border border-white/5 mb-6 shadow-inner relative z-10">
                        <div className="text-xs text-gray-400 mb-2 flex items-center gap-1"><Info size={12} /> LLM Response Snippet</div>
                        <p className="text-sm text-gray-300 leading-relaxed font-serif italic">
                            "For enterprise dashboards, <span className="bg-[#8FBB93]/20 text-white px-1 rounded border border-[#8FBB93]/30">Highcharts</span> is often preferred due to its extensive accessibility features and export module support [1]."
                        </p>
                    </div>

                    <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        whileInView={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.6 }}
                        className="bg-[#2A3A2C] rounded-xl p-4 border border-[#4A6B4E] shadow-lg relative z-10 hover:border-[#8FBB93] transition-colors cursor-pointer group"
                    >
                        <div className="flex gap-3">
                            <div className="w-10 h-10 rounded bg-[#4A6B4E]/30 text-[#8FBB93] flex items-center justify-center shrink-0 group-hover:bg-[#8FBB93] group-hover:text-[#2A3A2C] transition-colors">
                                <Globe size={20} />
                            </div>
                            <div>
                                <div className="text-[10px] font-mono text-[#8FBB93] mb-1">[1] OWNED DOMAIN</div>
                                <div className="text-sm font-bold text-white mb-1 line-clamp-1 group-hover:underline">Highcharts Accessibility Options</div>
                                <div className="text-xs text-gray-400 truncate w-full max-w-[200px]">highcharts.com/docs/accessibility/accessibility-module</div>
                            </div>
                        </div>
                    </motion.div>

                </motion.div>

            </div>
        </div>
    )
}
