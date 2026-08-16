'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { formatCurrency } from '@/lib/utils'
import { notify } from '@/lib/notify'
import { removeStorageFiles } from '@/lib/file-cleanup'
import type { Project, ProjectStatus } from '@/types/database'
import type { QueryResult, QueryResultMany } from '@/lib/supabase/typed'
import { requireManager, requireProjectAccess, requireAuth } from '@/lib/auth/guards'

export async function getProjects(filters?: { status?: ProjectStatus; search?: string }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const profileResult = (await supabase
    .from('profiles')
    .select('role, id')
    .eq('id', user.id)
    .single()) as QueryResult<{ role: string; id: string }>

  const profile = profileResult.data
  if (!profile) return []

  let query = supabase
    .from('projects')
    .select('*, coordinator:profiles!coordinator_id(id,full_name,role), sales_engineer:profiles!sales_engineer_id(id,full_name,role), installation_person:profiles!installation_id(id,full_name,role)')
    .order('created_at', { ascending: false })

  if (profile.role === 'sales_engineer') {
    query = query.eq('sales_engineer_id', user.id) as typeof query
  }

  if (filters?.status) {
    query = query.eq('status', filters.status) as typeof query
  }

  if (filters?.search) {
    // PostgREST parses , ( ) . as filter grammar — a raw value would let the
    // caller append arbitrary OR conditions. Strip them before interpolating.
    const safe = filters.search.replace(/[,()."\%]/g, ' ').trim()
    if (safe) {
      query = query.or(`client_name.ilike.%${safe}%,project_name.ilike.%${safe}%`) as typeof query
    }
  }

  const result = (await query) as QueryResultMany<Project>
  return result.data ?? []
}

export async function getProject(id: string) {
  // Any signed-in staff member may read a project's header row (name, client,
  // status, assigned team). The screen needs it to render the "ما عندك صلاحية"
  // notice — gating it here turned that designed notice into a raw 404 for
  // every installation manager opening a colleague's project.
  //
  // The data that actually matters is protected one level down: payments,
  // materials, custody, notes, attachments and installations each enforce
  // requireProjectAccess and return nothing to an unassigned user.
  const guard = await requireAuth()
  if ('error' in guard) return null
  const supabase = await createClient()
  const result = (await supabase
    .from('projects')
    .select('*, coordinator:profiles!coordinator_id(id,full_name,role), sales_engineer:profiles!sales_engineer_id(id,full_name,role), installation_person:profiles!installation_id(id,full_name,role)')
    .eq('id', id)
    .single()) as QueryResult<Project>
  return result.data
}

export async function createProject(formData: FormData) {
  const guard = await requireManager()
  if ('error' in guard) return { error: 'إنشاء المشاريع متاح لمهندس إدارة المشاريع والإدارة فقط' }
  const user = { id: guard.ctx.userId }

  const clientName = formData.get('client_name') as string
  const projectName = formData.get('project_name') as string
  const locationValue = formData.get('location') as string
  const totalAmount = formData.get('total_amount') as string
  const startDate = formData.get('start_date') as string
  const expectedEndDate = formData.get('expected_end_date') as string
  const customerAccountNo = formData.get('customer_account_no') as string
  const hasInstallation = formData.get('has_installation') !== 'false' // default true
  const coordinatorId = formData.get('coordinator_id') as string
  const salesEngineerId = formData.get('sales_engineer_id') as string
  const installationId = formData.get('installation_id') as string
  const contractUrl = formData.get('contract_url') as string

  if (!clientName || !projectName) {
    return { error: 'يرجى ملء اسم العميل واسم المشروع' }
  }

  const service = createServiceClient()
  const { data, error } = (await service.from('projects').insert({
    client_name: clientName,
    project_name: projectName,
    location: locationValue || null,
    customer_account_no: customerAccountNo || null,
    has_installation: hasInstallation,
    total_amount: totalAmount ? parseFloat(totalAmount) : null,
    start_date: startDate || null,
    expected_end_date: expectedEndDate || null,
    coordinator_id: coordinatorId || null,
    sales_engineer_id: salesEngineerId || null,
    installation_id: hasInstallation ? (installationId || null) : null,
    contract_url: contractUrl || null,
    status: 'active',
  } as never).select().single()) as unknown as { data: Project | null; error: Error | null }

  if (error) return { error: 'فشل إنشاء المشروع. حاول مرة أخرى' }

  await logActivity(service, data!.id, user.id, 'إنشاء المشروع', { project_name: projectName })

  revalidatePath('/projects')
  return { projectId: data!.id }
}

export async function updateProjectStatus(
  projectId: string,
  status: ProjectStatus,
  cancellationReason?: string
) {
  const guard = await requireManager()
  if ('error' in guard) return { error: 'تغيير حالة المشروع متاح لمهندس إدارة المشاريع والإدارة فقط' }
  const user = { id: guard.ctx.userId }

  if (status === 'cancelled' && !cancellationReason) {
    return { error: 'يجب إدخال سبب الإلغاء' }
  }

  if (status === 'completed') {
    const service = createServiceClient()
    const paymentsResult = (await service
      .from('payments')
      .select('status')
      .eq('project_id', projectId)
      .in('status', ['pending', 'partial'])) as unknown as { data: { status: string }[] | null }

    if (paymentsResult.data && paymentsResult.data.length > 0) {
      return { error: 'لا يمكن إغلاق المشروع — يوجد مدفوعات معلقة أو جزئية' }
    }
  }

  const service = createServiceClient()
  const { error } = (await service
    .from('projects')
    .update({
      status,
      ...(status === 'cancelled' ? { cancellation_reason: cancellationReason } : {}),
    } as never)
    .eq('id', projectId)) as unknown as { error: Error | null }

  if (error) return { error: 'فشل تحديث حالة المشروع' }

  await logActivity(service, projectId, user.id, `تغيير حالة المشروع إلى ${status}`, { status })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { success: true }
}

export async function updateProjectTeam(
  projectId: string,
  coordinatorId: string | null,
  salesEngineerId: string | null,
  installationId: string | null
) {
  // Manager-only. This was the escalation pivot: any employee could assign
  // THEMSELVES as the project's sales engineer or installation manager and
  // thereby unlock every ownership-gated action on it.
  const guard = await requireManager()
  if ('error' in guard) return { error: 'تعديل فريق المشروع متاح لمهندس إدارة المشاريع والإدارة فقط' }
  const user = { id: guard.ctx.userId }

  const service = createServiceClient()
  // Previous installation manager — to detect a new assignment
  const prevResult = (await service
    .from('projects').select('installation_id, project_name').eq('id', projectId).single()) as QueryResult<{ installation_id: string | null; project_name: string }>
  const prevInstallationId = prevResult.data?.installation_id ?? null

  const { error } = (await service
    .from('projects')
    .update({
      coordinator_id: coordinatorId || null,
      sales_engineer_id: salesEngineerId || null,
      installation_id: installationId || null,
    } as never)
    .eq('id', projectId)) as unknown as { error: Error | null }

  if (error) return { error: 'فشل تحديث الفريق' }

  await logActivity(service, projectId, user.id, 'تحديث فريق المشروع', {
    coordinator_id: coordinatorId,
    sales_engineer_id: salesEngineerId,
    installation_id: installationId,
  })

  // Notify a newly-assigned installation manager
  if (installationId && installationId !== prevInstallationId) {
    await notify(installationId, {
      title: 'تم تعيينك على مشروع',
      body: `أصبحت مدير التركيب لمشروع «${prevResult.data?.project_name ?? ''}»`,
      link: `/projects/${projectId}`, type: 'project', projectId,
    }, user.id)
  }

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { success: true }
}

export async function updateProjectInfo(
  projectId: string,
  data: {
    project_name: string
    client_name: string
    location: string | null
    customer_account_no: string | null
    has_installation: boolean
    total_amount: number | null
    start_date: string | null
    expected_end_date: string | null
  }
) {
  const guard = await requireManager()
  if ('error' in guard) return { error: 'تعديل بيانات المشروع متاح لمهندس إدارة المشاريع والإدارة فقط' }
  const user = { id: guard.ctx.userId }

  if (!data.project_name.trim() || !data.client_name.trim()) {
    return { error: 'اسم المشروع واسم العميل مطلوبان' }
  }

  const service = createServiceClient()
  const { error } = (await service
    .from('projects')
    .update({
      project_name: data.project_name.trim(),
      client_name: data.client_name.trim(),
      location: data.location || null,
      customer_account_no: data.customer_account_no || null,
      has_installation: data.has_installation,
      total_amount: data.total_amount,
      start_date: data.start_date || null,
      expected_end_date: data.expected_end_date || null,
    } as never)
    .eq('id', projectId)) as unknown as { error: Error | null }

  if (error) return { error: 'فشل تحديث بيانات المشروع' }

  await logActivity(service, projectId, user.id, 'تعديل معلومات المشروع', {
    project_name: data.project_name, client_name: data.client_name,
  })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { success: true }
}

export async function updateProjectAmount(projectId: string, totalAmount: number) {
  const guard = await requireManager()
  if ('error' in guard) return { error: 'تعديل قيمة المشروع متاح لمهندس إدارة المشاريع والإدارة فقط' }
  const user = { id: guard.ctx.userId }

  const service = createServiceClient()

  const { data: existing } = (await service
    .from('projects').select('total_amount').eq('id', projectId).single()) as unknown as { data: { total_amount: number | null } | null }

  const { error } = (await service
    .from('projects')
    .update({ total_amount: totalAmount } as never)
    .eq('id', projectId)) as unknown as { error: Error | null }

  if (error) return { error: 'فشل تحديث قيمة المشروع' }

  await logActivity(service, projectId, user.id, 'تعديل قيمة المشروع', {
    changes: {
      'قيمة المشروع': {
        from: existing?.total_amount != null ? formatCurrency(existing.total_amount) : '—',
        to: formatCurrency(totalAmount),
      },
    },
  })

  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function uploadContractUrl(projectId: string, url: string) {
  const service = createServiceClient()
  const { error } = (await service
    .from('projects')
    .update({ contract_url: url } as never)
    .eq('id', projectId)) as unknown as { error: Error | null }

  if (error) return { error: 'فشل رفع العقد' }
  revalidatePath(`/projects/${projectId}`)
  return { success: true }
}

export async function deleteProject(projectId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'غير مصرح' }

  const profileResult = (await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()) as QueryResult<{ role: string }>

  const role = profileResult.data?.role
  if (role !== 'admin' && role !== 'coordinator') return { error: 'الحذف متاح لمهندس إدارة المشاريع والإدارة فقط' }

  const service = createServiceClient()

  const projectResult = (await service
    .from('projects')
    .select('status, project_name')
    .eq('id', projectId)
    .single()) as unknown as { data: { status: string; project_name: string } | null }

  if (!projectResult.data) return { error: 'المشروع غير موجود' }

  const { status } = projectResult.data
  if (status !== 'cancelled' && status !== 'on_hold') {
    return { error: 'يمكن حذف المشاريع الملغاة أو المعلقة فقط' }
  }

  const projectName = projectResult.data.project_name

  // Every file this project owns — collected before the rows disappear so that
  // nothing is left behind in storage.
  const fileUrls = new Set<string>()
  const docs = (await service
    .from('documents').select('url').eq('project_id', projectId)) as unknown as { data: { url: string }[] | null }
  for (const d of docs.data ?? []) fileUrls.add(d.url)

  const custody = (await service
    .from('custody_entries').select('attachments').eq('project_id', projectId)) as unknown as {
      data: { attachments: { url: string }[] | null }[] | null
    }
  for (const c of custody.data ?? []) for (const f of c.attachments ?? []) fileUrls.add(f.url)

  // Delete every record that references the project (FK constraints), then the
  // project itself. Missing any of these makes the final delete fail silently.
  // Order matters: documents point at payments, so they go first.
  await service.from('project_notes').delete().eq('project_id', projectId)
  await service.from('notifications').delete().eq('project_id', projectId)
  await service.from('app_notifications').delete().eq('project_id', projectId)
  await service.from('technician_assignments').delete().eq('project_id', projectId)
  await service.from('activity_log').delete().eq('project_id', projectId)
  await service.from('documents').delete().eq('project_id', projectId)
  await service.from('custody_entries').delete().eq('project_id', projectId)
  await service.from('payments').delete().eq('project_id', projectId)
  await service.from('supply_orders').delete().eq('project_id', projectId)
  await service.from('installations').delete().eq('project_id', projectId)
  await service.from('materials').delete().eq('project_id', projectId)

  const { error } = (await service
    .from('projects').delete().eq('id', projectId)) as unknown as { error: { message?: string } | null }

  if (error) {
    console.error('[deleteProject] failed:', error)
    return { error: `فشل حذف المشروع — يوجد سجلات مرتبطة به. ${error.message ?? ''}`.trim() }
  }

  await removeStorageFiles(service, [...fileUrls])

  // Audit the deletion (project_id is gone, so record it against the name)
  await service.from('activity_log').insert({
    project_id: null,
    user_id: user.id,
    action: `حذف مشروع نهائياً: ${projectName}`,
    details: { project_id: projectId, project_name: projectName, files_removed: fileUrls.size },
  } as never)

  revalidatePath('/projects')
  revalidatePath('/dashboard')
  return { success: true }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logActivity(service: ReturnType<typeof createServiceClient>, projectId: string, userId: string, action: string, details: Record<string, any>) {
  await service.from('activity_log').insert({
    project_id: projectId,
    user_id: userId,
    action,
    details,
  } as never)
}
