import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/actions/auth'
import { getProjects } from '@/lib/actions/projects'
import { getAllOverduePayments } from '@/lib/actions/payments'
import { getAllInstallations } from '@/lib/actions/installation'
import { getPurchaseRequests } from '@/lib/actions/purchase-requests'
import { CoordinatorDashboard } from '@/components/dashboard/coordinator-dashboard'
import { AdminDashboard } from '@/components/dashboard/admin-dashboard'
import { SalesEngineerDashboard } from '@/components/dashboard/sales-engineer-dashboard'
import type { PaymentLite, MaterialLite, InstallationLite } from '@/components/dashboard/progress-overview'
import type { QueryResultMany } from '@/lib/supabase/typed'
import type { Profile } from '@/types/database'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')

  if (profile.role === 'installation') redirect('/installation')

  const [projects, overduePayments, installations] = await Promise.all([
    getProjects(),
    getAllOverduePayments(),
    getAllInstallations(),
  ])

  const supabase = await createClient()
  const usersResult = (await supabase.from('profiles').select('*').eq('is_active', true)) as QueryResultMany<Profile>
  const users = usersResult.data ?? []

  // Lightweight aggregates for the progress ratios (collection / materials)
  const paymentsResult = (await supabase
    .from('payments').select('project_id, amount, paid_amount, status, billing_status')) as QueryResultMany<PaymentLite>
  const materialsResult = (await supabase
    .from('materials').select('project_id, status')) as QueryResultMany<MaterialLite>
  const paymentsLite = paymentsResult.data ?? []
  const materialsLite = materialsResult.data ?? []
  const installationsLite: InstallationLite[] = installations.map((i) => ({ project_id: i.project_id, status: i.status }))

  // Purchase requests (BR) quick counts — coordinator/admin only
  let brActive = 0, brOverdue = 0
  if (profile.role === 'coordinator' || profile.role === 'admin') {
    const brRows = await getPurchaseRequests()
    const todaySA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
    brActive = brRows.filter((b) => b.stage !== 'completed').length
    brOverdue = brRows.filter((b) => b.stage !== 'completed' && b.due_date && b.due_date < todaySA).length
  }

  if (profile.role === 'coordinator') {
    const myProjects = projects.filter((p) => p.coordinator_id === profile.id)
    return (
      <CoordinatorDashboard
        profile={profile}
        myProjects={myProjects}
        allProjects={projects}
        overduePayments={overduePayments}
        installations={installations}
        payments={paymentsLite}
        materials={materialsLite}
        installationsLite={installationsLite}
        users={users}
        brActive={brActive}
        brOverdue={brOverdue}
      />
    )
  }

  if (profile.role === 'admin') {
    const myProjects = projects.filter((p) => p.coordinator_id === profile.id)
    return (
      <AdminDashboard
        profile={profile}
        projects={projects}
        myProjects={myProjects}
        overduePayments={overduePayments}
        installations={installations}
        users={users}
        payments={paymentsLite}
        materials={materialsLite}
        installationsLite={installationsLite}
        brActive={brActive}
        brOverdue={brOverdue}
      />
    )
  }

  if (profile.role === 'sales_engineer') {
    return (
      <SalesEngineerDashboard
        profile={profile}
        projects={projects}
      />
    )
  }

  redirect('/login')
}
