import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getProjects } from '@/lib/actions/projects'
import { getCurrentProfile } from '@/lib/actions/auth'
import { INSTALL_STAGES } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ProjectsList, type ProjectProgress } from '@/components/projects/projects-list'
import type { QueryResultMany } from '@/lib/supabase/typed'
import { materialsPercent } from '@/lib/config'
import { isBillingState } from '@/lib/billing'

const REQ_STAGE_KEYS = INSTALL_STAGES.filter((s) => !s.optional).map((s) => s.key)

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ billing?: string }>
}) {
  // Deep-link from the dashboard's billing chips: /projects?billing=collected
  const { billing: billingParam } = await searchParams
  const [projects, profile] = await Promise.all([getProjects(), getCurrentProfile()])
  if (!profile) return null

  // ── Per-project completion percentages (collection / materials / installation) ──
  const service = createServiceClient()
  const [paysRes, matsRes, instRes] = await Promise.all([
    service.from('payments').select('project_id, amount, paid_amount, status, billing_status'),
    service.from('materials').select('project_id, status, requested_at').order('requested_at', { ascending: false }),
    service.from('installations').select('project_id, stages, created_at').order('created_at', { ascending: false }),
  ]) as unknown as [
    { data: { project_id: string; amount: number; paid_amount: number; status: string; billing_status: string | null }[] | null },
    { data: { project_id: string; status: string }[] | null },
    { data: { project_id: string; stages: Record<string, { done?: boolean }> | null }[] | null },
  ]

  const payAgg = new Map<string, { paid: number; amount: number }>()
  // Which invoicing/collection states a project's payments carry — drives the
  // billing filter on the list. "both" also satisfies collected and invoiced.
  const billingByProj = new Map<string, Set<string>>()
  for (const p of paysRes.data ?? []) {
    if (p.status === 'cancelled') continue
    const a = payAgg.get(p.project_id) ?? { paid: 0, amount: 0 }
    a.paid += p.paid_amount ?? 0; a.amount += p.amount ?? 0
    payAgg.set(p.project_id, a)
    if (p.billing_status) {
      const set = billingByProj.get(p.project_id) ?? new Set<string>()
      set.add(p.billing_status)
      if (p.billing_status === 'both') { set.add('collected'); set.add('invoiced') }
      billingByProj.set(p.project_id, set)
    }
  }
  const matByProj = new Map<string, { status: string }>()
  for (const m of matsRes.data ?? []) if (!matByProj.has(m.project_id)) matByProj.set(m.project_id, m)
  const instByProj = new Map<string, Record<string, { done?: boolean }>>()
  for (const i of instRes.data ?? []) if (!instByProj.has(i.project_id)) instByProj.set(i.project_id, i.stages ?? {})

  const round = (n: number) => Math.round(n)
  const progress: Record<string, ProjectProgress> = {}
  for (const proj of projects) {
    const agg = payAgg.get(proj.id)
    const total = proj.total_amount && proj.total_amount > 0 ? proj.total_amount : (agg?.amount ?? 0)
    const collection = total > 0 ? round(((agg?.paid ?? 0) / total) * 100) : 0

    // Materials completion is stage-based, exactly like the project page, the
    // summary and the client share page. This screen was still counting items
    // whose per-item `status` equalled 'مكتمل' — a field that was removed when
    // materials moved to the SAP columns, so the count was always zero and a
    // fully delivered project reported 0%.
    const m = matByProj.get(proj.id)
    const materials = m ? materialsPercent(m.status) : 0

    let installation: number | null = null
    if (proj.has_installation) {
      const stages = instByProj.get(proj.id) ?? {}
      installation = REQ_STAGE_KEYS.length
        ? round((REQ_STAGE_KEYS.filter((k) => stages[k]?.done).length / REQ_STAGE_KEYS.length) * 100)
        : 0
    }
    const parts = [collection, materials, ...(installation !== null ? [installation] : [])]
    const overall = round(parts.reduce((a, b) => a + b, 0) / parts.length)
    progress[proj.id] = { overall, collection, materials, installation }
  }

  const billing: Record<string, string[]> = {}
  for (const [id, set] of billingByProj) billing[id] = [...set]

  // Sales engineers are view-only; coordinators (operational managers) and admin create projects
  const canCreate = ['coordinator', 'admin'].includes(profile.role)

  // Compute which projects belong to the current user
  const myProjectIds = new Set<string>()

  if (profile.role === 'coordinator') {
    for (const p of projects) {
      if ((p as { coordinator_id?: string }).coordinator_id === profile.id || p.coordinator?.id === profile.id) {
        myProjectIds.add(p.id)
      }
    }
  } else if (profile.role === 'sales_engineer') {
    for (const p of projects) {
      if ((p as { sales_engineer_id?: string }).sales_engineer_id === profile.id || p.sales_engineer?.id === profile.id) {
        myProjectIds.add(p.id)
      }
    }
  } else if (profile.role === 'installation') {
    // "my projects" = projects that have active installations
    const supabase = await createClient()
    const result = (await supabase
      .from('installations')
      .select('project_id')
      .not('status', 'eq', 'completed')) as QueryResultMany<{ project_id: string }>
    for (const i of result.data ?? []) myProjectIds.add(i.project_id)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="المشاريع"
        description={`${projects.length} مشروع`}
        action={
          canCreate ? (
            <Link href="/projects/new">
              <Button>
                <Plus className="h-4 w-4" />
                مشروع جديد
              </Button>
            </Link>
          ) : undefined
        }
      />
      <ProjectsList
        projects={projects}
        myProjectIds={myProjectIds}
        currentProfile={profile}
        canCreate={canCreate}
        progress={progress}
        billing={billing}
        initialBilling={isBillingState(billingParam) ? billingParam : null}
      />
    </div>
  )
}
