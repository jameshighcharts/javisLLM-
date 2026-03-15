/* biome-ignore-all lint/suspicious/noArrayIndexKey: display-only mapped lists in this file */
/* biome-ignore-all lint/a11y/noSvgWithoutTitle: decorative inline icons */
import { motion } from "framer-motion";
import {
	Activity,
	ArrowRight,
	BarChart3,
	Bot,
	CheckCircle2,
	Eye,
	GitPullRequest,
	Layers,
	Link as LinkIcon,
	PlayCircle,
	Search,
	Sparkles,
	Target,
	Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const CHIP_DATA = [
	"Tell us about yourself",
	"Where do you spend time typing?",
	"What is your role?",
	"Draft an email",
	"Write an essay",
	"Summarize this document",
	"Generate a report",
	"Create a presentation",
];

// Duplicate for seamless loop
const MARQUEE_CHIPS = [...CHIP_DATA, ...CHIP_DATA, ...CHIP_DATA];

export default function Landing() {
	return (
		<div className="min-h-screen flex flex-col font-sans overflow-x-hidden bg-[#FDFBF7]">
			{/* Section A: The Navigation Bar */}
			<header className="flex justify-between items-center py-6 px-[5%] relative z-50">
				<div className="flex items-center gap-2 font-bold text-xl text-[#2D3748]">
					<span>🍋</span>
					Lemon
				</div>

				<nav className="hidden md:flex items-center gap-8 text-sm text-[#718096] font-sans font-medium">
					<a
						href="#how-it-works"
						className="hover:text-[#2D3748] transition-colors"
					>
						How it works
					</a>
					<a
						href="#features"
						className="hover:text-[#2D3748] transition-colors"
					>
						Features
					</a>
					<a href="#pricing" className="hover:text-[#2D3748] transition-colors">
						Pricing
					</a>
					<a
						href="#download"
						className="hover:text-[#2D3748] transition-colors"
					>
						Download
					</a>
				</nav>

				<div className="flex items-center gap-6">
					<Link
						to="/login"
						className="text-sm font-medium hover:opacity-70 transition-opacity text-[#718096]"
					>
						Sign in
					</Link>
					<Link
						to="/login"
						className="text-sm font-medium px-4 py-2 rounded-full text-white shadow-sm transition-all hover:shadow-md bg-[#1A202C]"
					>
						Free Download
					</Link>
				</div>
			</header>

			{/* Main Content Group */}
			<main className="flex-1 flex flex-col relative">
				{/* Section B: Hero Typography */}
				<section
					id="hero-text"
					className="flex flex-col items-center justify-center text-center mt-20 px-4 relative z-50"
				>
					<h1 className="text-[4rem] md:text-[64px] font-serif font-medium text-[#2D3748] leading-[1.1] tracking-tight max-w-4xl">
						Turn words into actions
					</h1>

					<p className="font-sans text-[18px] text-[#718096] max-w-[600px] mt-4 leading-relaxed">
						Voice-first AI that understands exactly what you mean, automating
						your workflows and transforming how you interact with your devices.
					</p>

					<div className="flex flex-row gap-4 mt-8">
						<button
							type="button"
							className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#FDE047] text-black font-semibold shadow-sm hover:shadow-md transition-shadow"
						>
							<svg
								className="w-5 h-5"
								viewBox="0 0 384 512"
								fill="currentColor"
							>
								<path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
							</svg>
							Download for Mac
						</button>
						<button
							type="button"
							className="flex items-center gap-2 px-6 py-3 rounded-full bg-transparent border border-gray-300 text-[#2D3748] font-semibold hover:bg-gray-50 transition-colors"
						>
							Watch Demo
						</button>
					</div>
				</section>

				{/* Section C: The Animated Centerpiece & Marquee */}
				<section
					id="animation-area"
					className="relative h-[400px] w-full overflow-hidden flex items-center justify-center mt-16 pb-20"
				>
					{/* Layer 2: The Scrolling Marquee Rows (Behind the center block) */}

					<div className="marquee-row top">
						{MARQUEE_CHIPS.map((text, idx) => (
							<div
								key={`top-${idx}`}
								className={`chip ${idx % 2 === 0 ? "light" : "dark"}`}
							>
								{text}
							</div>
						))}
					</div>

					<div className="marquee-row bottom">
						{MARQUEE_CHIPS.map((text, idx) => (
							<div
								key={`bottom-${idx}`}
								className={`chip ${idx % 2 === 1 ? "light" : "dark"}`}
							>
								{text}
							</div>
						))}
					</div>

					{/* Layer 1: The Z-Index Center Graphic (On top) */}
					{/* Positioned dead-center with z-index: 20 */}
					<div className="absolute z-20 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
						<div className="w-64 h-64 bg-gray-300 rotate-45 rounded-3xl shadow-2xl flex items-center justify-center relative overflow-hidden">
							{/* Small gradient/shine effect to look slightly 3D */}
							<div className="absolute inset-0 bg-gradient-to-tr from-black/10 to-transparent" />
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
