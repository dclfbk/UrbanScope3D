import Link from 'next/link';

export default function Home() {
  return (
    <main className="relative w-full h-screen overflow-hidden">

      <video
        autoPlay
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover"
      >
        <source src="/BolognaLowQuality.mp4" type="video/mp4" />
      </video>

      <div className="absolute inset-0 bg-black/60" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-8">

        <h1
          className="text-8xl md:text-9xl font-black text-white uppercase text-center"
          style={{
            textShadow: '0 0 20px rgba(0,200,255,0.8), 0 0 40px rgba(0,200,255,0.4)',
            letterSpacing: '0.4em',
            paddingLeft: '0.4em'
          }}
        >
          BOLOGNA
        </h1>

        <div className="flex items-center gap-4 w-64">
          <div className="flex-1 h-px bg-cyan-400/60" />
          <div className="w-2 h-2 rotate-45 bg-cyan-400" />
          <div className="flex-1 h-px bg-cyan-400/60" />
        </div>

        <p className="text-cyan-400/80 text-base uppercase" style={{ letterSpacing: '0.5em', fontFamily: 'monospace' }}>
          Exploring Urban Environments
        </p>

        <Link
          href="/explore"
          className="group relative mt-3 px-12 py-4 border border-cyan-400/60 text-cyan-300 text-sm uppercase font-semibold cursor-pointer overflow-hidden transition-all duration-300 hover:text-black hover:border-cyan-300 active:scale-95"
          style={{ fontFamily: 'monospace', letterSpacing: '0.4em' }}
        >
          <span className="absolute inset-0 bg-cyan-400 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out" />
          <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-cyan-400" />
          <span className="absolute top-0 right-0 w-2 h-2 border-t border-r border-cyan-400" />
          <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-cyan-400" />
          <span className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-cyan-400" />
          <span className="relative z-10">ESPLORA</span>
        </Link>

      </div>

      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 2px)' }}
      />

    </main>
  );
}