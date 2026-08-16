import { Wallet, Layers, TrendingUp, ArrowDownCircle, Clock } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import { BILLING_STATES, BILLING_LABELS, BILLING_CHIP, matchesBilling } from '@/lib/billing'
import type { Project } from '@/types/database'

export interface PaymentLite { project_id: string; amount: number; paid_amount: number; status: string; billing_status?: string | null }
export interface MaterialLite { project_id: string; status: string }
export interface InstallationLite { project_id: string; status: string }

interface ProgressOverviewProps {
  projects: Project[]
  payments: PaymentLite[]
  materials: MaterialLite[]
  installations: InstallationLite[]
  overdueAmount?: number
}

export function ProgressOverview({ projects, payments, materials, installations, overdueAmount = 0 }: ProgressOverviewProps) {
  const ids = new Set(projects.map((p) => p.id))

  // ── Financial ──
  const scopedPayments = payments.filter((p) => ids.has(p.project_id) && p.status !== 'cancelled')
  const billed = scopedPayments.reduce((s, p) => s + (p.amount ?? 0), 0)        // الإجمالي المطلوب
  const collected = scopedPayments.reduce((s, p) => s + (p.paid_amount ?? 0), 0) // المحصّل
  const remaining = Math.max(0, billed - collected)                              // المتبقّي للتحصيل
  const totalValue = projects.reduce((s, p) => s + (p.total_amount ?? 0), 0)     // قيمة المشاريع
  const collectionPct = billed > 0 ? Math.round((collected / billed) * 100) : 0

  const paidCount = scopedPayments.filter((p) => p.status === 'paid').length
  const partialCount = scopedPayments.filter((p) => p.status === 'partial').length
  const pendingCount = scopedPayments.filter((p) => p.status === 'pending' || p.status === 'overdue').length

  // ── Lifecycle pipeline (exclude cancelled) ──
  const installByProject = new Map<string, string[]>()
  installations.forEach((i) => {
    if (!ids.has(i.project_id)) return
    const arr = installByProject.get(i.project_id) ?? []
    arr.push(i.status)
    installByProject.set(i.project_id, arr)
  })
  const materialDelivered = new Set(materials.filter((m) => ids.has(m.project_id) && (m.status === 'delivered' || m.status === 'ready')).map((m) => m.project_id))
  const paidByProject = new Set(payments.filter((p) => ids.has(p.project_id) && (p.paid_amount ?? 0) > 0).map((p) => p.project_id))

  const stages = { contract: 0, payments: 0, materials: 0, install: 0, done: 0 }
  const livingProjects = projects.filter((p) => p.status !== 'cancelled')
  for (const p of livingProjects) {
    const insts = installByProject.get(p.id) ?? []
    if (p.status === 'completed' || insts.includes('completed')) stages.done++
    else if (insts.length > 0) stages.install++
    else if (materialDelivered.has(p.id)) stages.materials++
    else if (paidByProject.has(p.id)) stages.payments++
    else stages.contract++
  }
  const pipelineTotal = livingProjects.length

  const PIPE: { key: keyof typeof stages; label: string; bar: string; dot: string }[] = [
    { key: 'contract', label: 'تعاقد', bar: 'bg-slate-400', dot: 'bg-slate-400' },
    { key: 'payments', label: 'دفعات', bar: 'bg-blue-500', dot: 'bg-blue-500' },
    { key: 'materials', label: 'مواد', bar: 'bg-amber-500', dot: 'bg-amber-500' },
    { key: 'install', label: 'تركيب', bar: 'bg-purple-500', dot: 'bg-purple-500' },
    { key: 'done', label: 'مكتمل', bar: 'bg-emerald-500', dot: 'bg-emerald-500' },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Financial summary ── */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
            <Wallet className="h-4 w-4 text-emerald-700" />
          </div>
          <h3 className="font-bold text-gray-900">الملخص المالي</h3>
        </div>

        {/* Collection bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm text-gray-500">نسبة التحصيل</span>
            <span className="text-sm font-bold text-emerald-600">{collectionPct}%</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${collectionPct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {formatCurrency(collected)} محصّل من {formatCurrency(billed)} مطلوب
          </p>
        </div>

        {/* Figures grid */}
        <div className="grid grid-cols-2 gap-2.5">
          <FigureBox icon={<Layers className="h-3.5 w-3.5" />} label="قيمة المشاريع" value={formatCurrency(totalValue)} tone="text-gray-900" />
          <FigureBox icon={<TrendingUp className="h-3.5 w-3.5" />} label="إجمالي المطلوب" value={formatCurrency(billed)} tone="text-gray-900" />
          <FigureBox icon={<ArrowDownCircle className="h-3.5 w-3.5" />} label="المحصّل" value={formatCurrency(collected)} tone="text-emerald-600" />
          <FigureBox icon={<Clock className="h-3.5 w-3.5" />} label="المتبقّي للتحصيل" value={formatCurrency(remaining)} tone="text-amber-600" />
        </div>

        {/* Payment status quick summary */}
        {(paidCount + partialCount + pendingCount) > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {paidCount} مدفوعة
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> {partialCount} جزئية
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> {pendingCount} معلّقة
            </span>
          </div>
        )}

        {/* Invoicing / collection breakdown — each chip opens the projects
            list already filtered to that state. */}
        {BILLING_STATES.some((st) => scopedPayments.some((p) => matchesBilling(p.billing_status, st))) && (
          <div className="mt-2.5 border-t border-gray-50 pt-2.5">
            <p className="mb-1.5 text-[11px] font-semibold text-gray-400">حالة الفوترة والتحصيل</p>
            <div className="flex flex-wrap items-center gap-2">
              {BILLING_STATES.map((state) => {
                const matched = scopedPayments.filter((p) => matchesBilling(p.billing_status, state))
                if (matched.length === 0) return null
                const sum = matched.reduce((t, p) => t + (p.paid_amount ?? 0), 0)
                return (
                  <Link key={state} href={`/projects?billing=${state}`}
                    className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80',
                      BILLING_CHIP[state])}>
                    {BILLING_LABELS[state]}
                    <span className="font-bold">{matched.length}</span>
                    <span className="opacity-70">· {formatCurrency(sum)}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {overdueAmount > 0 && (
          <div className="mt-2.5 flex items-center justify-between rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5">
            <span className="text-xs font-medium text-red-700">منها متأخر التحصيل</span>
            <span className="text-sm font-bold text-red-600">{formatCurrency(overdueAmount)}</span>
          </div>
        )}
      </div>

      {/* ── Lifecycle pipeline ── */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100">
            <Layers className="h-4 w-4 text-indigo-700" />
          </div>
          <h3 className="font-bold text-gray-900">مراحل المشاريع</h3>
          <span className="ms-auto text-xs text-gray-400">{pipelineTotal} مشروع</span>
        </div>

        {pipelineTotal === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">لا توجد مشاريع نشطة لعرض مراحلها</p>
        ) : (
          <>
            {/* Stacked bar */}
            <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
              {PIPE.map(({ key, bar }) => {
                const v = stages[key]
                if (v === 0) return null
                return <div key={key} className={cn('h-full', bar)} style={{ width: `${(v / pipelineTotal) * 100}%` }} title={`${v}`} />
              })}
            </div>

            {/* Legend */}
            <div className="space-y-2.5">
              {PIPE.map(({ key, label, dot }) => {
                const v = stages[key]
                const pct = pipelineTotal > 0 ? Math.round((v / pipelineTotal) * 100) : 0
                return (
                  <div key={key} className="flex items-center gap-2.5">
                    <span className={cn('h-2.5 w-2.5 rounded-full shrink-0', dot)} />
                    <span className="text-sm text-gray-700 flex-1">{label}</span>
                    <span className="text-sm font-bold text-gray-900">{v}</span>
                    <span className="text-xs text-gray-400 w-9 text-end">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FigureBox({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className={cn('text-sm font-bold', tone)}>{value}</p>
    </div>
  )
}
