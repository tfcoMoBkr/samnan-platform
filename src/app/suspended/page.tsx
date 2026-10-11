import type { Metadata } from 'next'

// Shown for every route while SERVICE_SUSPENDED=true (see middleware.ts).
// Deliberately static: no Supabase calls, no session — it must render even if
// everything else is off.
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'الخدمة متوقفة مؤقتاً',
  robots: { index: false, follow: false },
}

export default function SuspendedPage() {
  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#0b1116] px-4 py-10">
      <div className="w-full max-w-md text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/thakaa-flow.png"
          alt="ذكاء فلو"
          className="mx-auto h-36 w-36 rounded-3xl object-cover shadow-[0_0_60px_rgba(34,211,238,0.25)] ring-1 ring-cyan-400/20"
        />

        <h1 className="mt-8 text-2xl font-bold text-white sm:text-3xl">الخدمة متوقفة مؤقتاً</h1>
        <p className="mt-4 text-base leading-8 text-slate-300">
          تم إيقاف الخدمة على هذه المنصة حالياً.
          <br />
          لإعادة تفعيل الخدمة يرجى التواصل مع فريق ذكاء فلو.
        </p>

        <a
          href="https://tfco.sa"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center justify-center rounded-xl bg-cyan-500 px-8 py-3 text-base font-semibold text-[#0b1116] transition hover:bg-cyan-400"
        >
          تواصل معنا لإعادة التفعيل
        </a>

        <p className="mt-6 text-sm text-slate-500" dir="ltr">tfco.sa</p>
      </div>
    </main>
  )
}
