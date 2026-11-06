import Link from "next/link";
import type { ReactNode } from "react";
import { Mark, Wordmark } from "@/components/Mark";
import { LiveStrip } from "@/components/landing/LiveStrip";
import { CountUp, Reveal } from "@/components/landing/motion";
import { HeroOrb } from "@/components/landing/HeroOrb";
import { ScrollBand } from "@/components/landing/ScrollBand";
import { TremorField } from "@/components/landing/TremorField";
import { WeeklyBars } from "@/components/landing/WeeklyBars";
import { POOL, summary } from "@/lib/dataset";
import { fmtUsd } from "@/lib/format";

const REPO = "https://github.com/zeel991/tremor-mumbai";
const SPEC = `${REPO}/blob/main/docs/spec.md`;
const APP = "/app";


export default function Landing() {
  const { exOutlier, all, worst } = summary;
  return (
    <div
      className="relative overflow-x-clip"
      data-band-root
      data-string="progress"
      data-string-id="page"
      data-string-key="--page-progress"
      data-string-enter-el="top"
      data-string-enter-vp="top"
      data-string-exit-el="bottom"
      data-string-exit-vp="bottom"
    >
      <div aria-hidden="true" className="page-progress fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-signal" />
      <ScrollBand />
      <Nav />
      <Hero />

      {/* ---- the problem, measured --------------------------------------------------- */}
      <section id="data" className="relative scroll-mt-16 border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-32">
          <Reveal>
            <Eyebrow>The problem</Eyebrow>
            <h2 className="mt-4 max-w-3xl text-[34px] font-medium leading-[1.08] tracking-tight sm:text-[48px]">
              Arbitrage took <span className="text-signal"><CountUp to={exOutlier.arbShare * 100} format="pct" /></span> of LP fees in UNI/WETH.
            </h2>
            <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-2">
              We valued every swap in the {POOL} pool on Ethereum at Binance one-minute prices. Measured that way, arbitrage loss came to{" "}
              {fmtUsd(exOutlier.arb / 1e6, 2)}M against {fmtUsd(exOutlier.fees / 1e6, 2)}M of fees over {exOutlier.n} weeks (one outlier week excluded), and it lands in the weeks the market moves.
            </p>
          </Reveal>

          <Reveal bare className="mt-14 rounded-2xl border border-line bg-surface/60 p-5 sm:p-8">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
              <div className="text-[14px] text-ink-2">LP fees minus arbitrage loss, per week</div>
              <div className="flex items-center gap-4 text-[12px] text-ink-3">
                <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-signal" /> losing week</span>
                <span className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-line-2" /> profitable week</span>
              </div>
            </div>
            <WeeklyBars />
          </Reveal>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Stat delay={0} value={<CountUp to={all.losing} format="int" suffix={` of ${all.n}`} />} label="weeks LPs lost money" />
            <Stat delay={100} value={<CountUp to={-worst.net} format="usd" />} label={`lost in the week of ${fmtDay(worst.week)}`} />
            <Stat delay={200} value={<CountUp to={exOutlier.net / 1e6} format="usdM" />} label="left for LPs, outlier week excluded" />
          </div>
        </div>
      </section>

      {/* ---- how it works ------------------------------------------------------------- */}
      <section id="how" className="relative scroll-mt-16 border-t border-line">
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_60%_at_50%_40%,black,transparent)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-32">
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
            <h2 className="mt-4 max-w-3xl text-[34px] font-medium leading-[1.08] tracking-tight sm:text-[48px] split-up" data-string="split" data-string-split="word-line[start]">Measure the loss. Charge for it. Buy cover with it.</h2>
          </Reveal>

          <div className="relative mt-16">
            <div className="absolute left-0 right-0 top-[27px] hidden h-px overflow-hidden bg-line md:block">
              <div className="rail-pulse h-px w-1/4 bg-gradient-to-r from-transparent via-signal to-transparent" />
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 120}>
                  <div data-string="spotlight" className="st-spotlight h-full rounded-2xl border border-line bg-surface p-6">
                    <div className="flex h-[54px] items-center">
                      <span className="flex h-[54px] w-[54px] items-center justify-center rounded-xl border border-line-2 bg-page font-mono text-[15px] text-signal">{s.n}</span>
                    </div>
                    <h3 className="mt-6 text-[22px] font-medium tracking-tight">{s.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
                    <div className="mt-6 border-t border-line pt-4 font-mono text-[12px] text-ink-3">{s.tech}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---- the payout, two real weeks ---------------------------------------------- */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 md:py-32">
          <Reveal>
            <Eyebrow>The payout</Eyebrow>
            <h2 className="mt-4 max-w-3xl text-[34px] font-medium leading-[1.08] tracking-tight sm:text-[48px] split-up" data-string="split" data-string-split="word-line[start]">Cover pays more when the market moves more.</h2>
            <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-2">
              Each LONG claim pays out from the volatility of UNI/ETH over one week, sampled from every Chainlink price update in the week. Two historical weeks,
              replayed on a mainnet fork from real Chainlink history:
            </p>
          </Reveal>
          <div className="mt-14 grid gap-5 md:grid-cols-2">
            <Payout delay={0} week="Week of 6 Oct 2025" rounds={50} vol="305%" pays={1} note="The October crash. Volatility passed the 150% cap, so LONG paid in full." hot />
            <Payout delay={120} week="Week of 24 Feb 2025" rounds={17} vol="59.8%" pays={0.159} note="A calmer week. LONG paid 15.9% of the maximum and SHORT took the rest." />
          </div>
        </div>
      </section>

      {/* ---- trust -------------------------------------------------------------------- */}
      <section className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 md:grid-cols-[1.1fr_1fr] md:py-32">
          <Reveal>
            <Eyebrow>Built in the open</Eyebrow>
            <h2 className="mt-4 text-[34px] font-medium leading-[1.08] tracking-tight sm:text-[44px] split-up" data-string="split" data-string-split="word-line[start]">Built at ETHGlobal Mumbai. Every line is public.</h2>
            <p className="mt-5 max-w-xl text-[16px] leading-relaxed text-ink-2">
              The contracts, the Chainlink workflow, the data behind every number on this page and the spec we built from are in one repository, under the MIT licence.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={REPO} className="btn-ghost" target="_blank" rel="noreferrer">
                GitHub repository <Arrow />
              </a>
              <a href={SPEC} className="btn-ghost" target="_blank" rel="noreferrer">
                Read the spec <Arrow />
              </a>
            </div>
          </Reveal>
          <div className="grid grid-cols-2 gap-px self-start overflow-hidden rounded-2xl border border-line bg-line">
            {PROOF.map((p, i) => (
              <Reveal key={p.label} delay={i * 80} className="bg-surface p-6">
                <div className="num text-[32px] font-medium tracking-tight">{p.value}</div>
                <div className="mt-1 text-[13.5px] leading-snug text-ink-2">{p.label}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---- FAQ ---------------------------------------------------------------------- */}
      <section id="faq" className="scroll-mt-16 border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-24 sm:px-6 md:grid-cols-[1fr_1.6fr] md:py-32">
          <Reveal>
            <Eyebrow>Questions</Eyebrow>
            <h2 className="mt-4 text-[34px] font-medium leading-[1.08] tracking-tight sm:text-[44px] split-up" data-string="split" data-string-split="word-line[start]">The short answers.</h2>
          </Reveal>
          <Reveal className="divide-y divide-line border-y border-line">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="text-[22px] font-light text-ink-3 transition-transform duration-300 group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-2">{f.a}</p>
              </details>
            ))}
          </Reveal>
        </div>
      </section>

      {/* ---- closing CTA -------------------------------------------------------------- */}
      <section className="relative overflow-hidden border-t border-line">
        <div className="absolute inset-0">
          <TremorField />
        </div>
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:linear-gradient(to_top,black,transparent)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(42%_48%_at_50%_50%,rgb(9_9_10/0.88),rgb(9_9_10/0.4)_60%,transparent)]" />
        <Reveal className="relative mx-auto flex max-w-6xl flex-col items-center px-4 py-28 text-center sm:px-6 md:py-36">
          <div data-band-mark>
            <Mark size={40} />
          </div>
          <h2 className="mt-8 max-w-3xl text-[36px] font-medium leading-[1.05] tracking-tight sm:text-[56px] split-up" data-string="split" data-string-split="word-line[start]">See the hook, the cover and the payouts working.</h2>
          <p className="mt-5 max-w-xl text-[16px] text-ink-2">The app reads every number straight from the contracts on a mainnet fork. Quotes work without a wallet.</p>
          <Link href={APP} data-string="magnetic" data-string-strength="0.35" data-string-radius="140" className="btn-primary magnetic mt-9 px-6 py-3 text-[15px]">
            Open the app <Arrow />
          </Link>
        </Reveal>
      </section>

      <Footer />
    </div>
  );
}

/* ---- sections ------------------------------------------------------------------------- */

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-page/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
        <Wordmark />
        <nav className="hidden items-center gap-7 text-[14px] text-ink-2 md:flex">
          <a href="#data" className="hover:text-ink">The data</a>
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
          <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
        </nav>
        <Link href={APP} className="btn-primary ml-auto">
          Open the app
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-[100svh] flex-col bg-[#030304]">
      <div data-band-orb className="absolute inset-0 opacity-60 md:left-[42%] md:opacity-100">
        <div data-string="parallax" data-string-parallax="-0.18" className="absolute inset-0">
          <HeroOrb />
        </div>
      </div>
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(80%_70%_at_30%_30%,black,transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#030304_0%,rgb(3_3_4/0.75)_35%,transparent_65%)] max-md:bg-[linear-gradient(180deg,rgb(3_3_4/0.2),rgb(3_3_4/0.75))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-page" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-10 pt-32 sm:px-6 md:pt-40">
        <h1 data-string="split" data-string-split="char-line[start]" className="split-chars max-w-4xl text-[46px] font-medium leading-[0.98] tracking-[-0.035em] sm:text-[72px] lg:text-[92px]">
          Volatility cover for Uniswap LPs.
        </h1>
        <p className="fade-up mt-7 max-w-xl text-[17px] leading-relaxed text-ink-2 sm:text-[19px]" style={{ animationDelay: "650ms" }}>
          Swappers pay a fee sized from measured arbitrage loss. It buys cover that pays the pool&apos;s liquidity when prices swing.
        </p>
        <div data-band-cta className="fade-up mt-9 flex flex-wrap items-center gap-x-6 gap-y-3" style={{ animationDelay: "800ms" }}>
          <Link href={APP} data-string="magnetic" data-string-strength="0.35" data-string-radius="140" className="btn-primary magnetic px-6 py-3 text-[15px]">
            Open the app <Arrow />
          </Link>
          <a href={REPO} target="_blank" rel="noreferrer" className="text-[15px] text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            Read the code
          </a>
        </div>
        <div data-band-strip className="fade-up mt-auto pt-16" style={{ animationDelay: "1000ms" }}>
          <LiveStrip />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-[13.5px] text-ink-3 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Wordmark />
          <span>ETHGlobal Mumbai 2026</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href={APP} className="hover:text-ink">App</Link>
          <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub</a>
          <a href={SPEC} target="_blank" rel="noreferrer" className="hover:text-ink">Spec</a>
          <a href={`${REPO}/blob/main/data/README.md`} target="_blank" rel="noreferrer" className="hover:text-ink">Data method</a>
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="hover:text-ink">MIT licence</a>
        </nav>
      </div>
    </footer>
  );
}

/* ---- pieces --------------------------------------------------------------------------- */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 font-mono text-[12px] uppercase tracking-[0.14em] text-ink-3">
      <span className="h-px w-6 bg-signal" />
      {children}
    </div>
  );
}

function Stat({ value, label, delay }: { value: ReactNode; label: string; delay: number }) {
  return (
    <Reveal delay={delay} className="rounded-2xl border border-line bg-surface p-6">
      <div className="text-[34px] font-medium tracking-tight">{value}</div>
      <div className="mt-1 text-[14px] text-ink-2">{label}</div>
    </Reveal>
  );
}

function Payout({ week, rounds, vol, pays, note, hot = false, delay }: { week: string; rounds: number; vol: string; pays: number; note: string; hot?: boolean; delay: number }) {
  return (
    <Reveal delay={delay} bare className={`reveal overflow-hidden rounded-2xl border ${hot ? "border-signal/40" : "border-line"} bg-surface`}>
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-6 py-4">
        <div className="text-[15px] font-medium">{week}</div>
        <div className="font-mono text-[12px] text-ink-3">{rounds} Chainlink updates</div>
      </div>
      <div className="grid grid-cols-2 gap-6 px-6 py-7">
        <div>
          <div className="text-[12.5px] text-ink-3">Realized volatility</div>
          <div className="num mt-1 text-[40px] font-medium leading-none tracking-tight">{vol}</div>
        </div>
        <div>
          <div className="text-[12.5px] text-ink-3">LONG paid</div>
          <div className={`num mt-1 text-[40px] font-medium leading-none tracking-tight ${hot ? "text-signal" : ""}`}>{Math.round(pays * 1000) / 10}%</div>
        </div>
      </div>
      <div className="px-6">
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div
            className="h-full origin-left rounded-full bg-signal transition-transform delay-300 duration-[1200ms] ease-out [[data-shown=false]_&]:scale-x-0"
            style={{ width: `${Math.max(2, pays * 100)}%` }}
          />
        </div>
      </div>
      <p className="px-6 pb-6 pt-4 text-[14px] leading-relaxed text-ink-2">{note}</p>
    </Reveal>
  );
}

function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

function fmtDay(isoWeek: string) {
  return new Date(`${isoWeek}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/* ---- content -------------------------------------------------------------------------- */

const STEPS = [
  {
    n: "01",
    title: "Measure",
    body: "A Chainlink CRE workflow values every swap in the pool at exchange prices and reports last week's arbitrage loss on-chain.",
    tech: "Chainlink CRE  →  TremorReceiver",
  },
  {
    n: "02",
    title: "Charge",
    body: "A Uniswap v4 hook charges swappers a fee sized from that loss, capped at 0.30%. With no fresh report, it charges nothing.",
    tech: "Uniswap v4 hook fee  ·  ERC-6909 claims",
  },
  {
    n: "03",
    title: "Cover",
    body: "The fee buys LONG claims on UNI/ETH volatility from a 1inch Aqua strategy. When a week settles, the payout is donated to the pool's in-range liquidity.",
    tech: "1inch Aqua  ·  SwapVM instruction 0x22",
  },
];

const PROOF = [
  { value: "54 / 54", label: "unit and invariant tests pass" },
  { value: "7 / 7", label: "tests pass on a mainnet fork" },
  { value: "10,508", label: "pricing outputs match a separate Python model exactly" },
  { value: "3,000", label: "pips set by the Chainlink workflow alone, in simulation" },
];

const FAQ = [
  {
    q: "Who pays for the cover?",
    a: "Swappers in the Tremor pool, through a Uniswap v4 hook fee. The fee is sized from last week's measured arbitrage loss divided by volume, halved, and capped at 0.30%. If no fresh measurement arrives, the fee drops to zero.",
  },
  {
    q: "What does an LP get?",
    a: "Nothing to claim or manage. The hook holds the cover. When a week settles, it redeems its LONG claims for WETH and donates that WETH to the liquidity in range at the time, over a few hundred blocks. That rewards current liquidity, not necessarily the LPs who took the loss.",
  },
  {
    q: "Is it live on mainnet?",
    a: (
      <>
        No. Tremor runs in two places. The full demo runs on a local fork of Ethereum mainnet, against the deployed Uniswap v4 PoolManager, 1inch Aqua
        registry and Chainlink UNI/ETH feed, including two real weeks settled from history. It is also{" "}
        <a href="https://sepolia.etherscan.io/address/0x3FF7250cB8BBC51DefC8eB4fEB3cFa9A05ae8044" target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-signal-2">
          deployed on Sepolia
        </a>
        , against the real v4 PoolManager and 1inch Aqua, where it settles on Chainlink ETH/USD with a test UNI token.
      </>
    ),
  },
  {
    q: "Why not just raise the LP fee instead?",
    a: "For average returns, you should. We ran both on the same two years: paying the same add-on straight to LPs earns about 8% more in total and swings less week to week. Spending it on Tremor cover instead cut the worst week from about -$124k to -$71k. Tremor is for LPs who want the tail cut, not a higher mean. The script is in the repo (data/benchmark_dynamic_fee.py).",
  },
  {
    q: "What are the known limits?",
    a: "The numbers are pool-wide, so a single LP can do better or worse. Donations can be front-run by just-in-time liquidity; dripping them limits that but does not stop it. And the cover only works on a new v4 pool, so LPs would have to move to it.",
  },
];
