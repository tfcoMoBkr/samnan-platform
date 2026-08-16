'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowRight, Building2, Calendar, DollarSign, FileText, TrendingUp,
  CheckCircle2, PauseCircle, XCircle, PlayCircle, AlertTriangle, Users, Briefcase, Edit2, Trash2, MapPin, Hammer,
  Share2, Copy, Check, ClipboardList,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { ProjectStatusBadge } from '@/components/shared/status-badge'
import { PaymentsTab } from '@/components/payments/payments-tab'
import { InstallationTab } from '@/components/installation/installation-tab'
import { MaterialsTab } from '@/components/projects/materials-tab'
import { ActivityTab } from '@/components/projects/activity-tab'
import { AttachmentsTab } from '@/components/projects/attachments-tab'
import { ProjectBoard } from '@/components/projects/project-board'
import { InstallationAttachments } from '@/components/installation/installation-attachments'
import { PurchaseBoard } from '@/components/purchase/purchase-board'
import { updateProjectStatus, updateProjectTeam, updateProjectAmount, updateProjectInfo, deleteProject } from '@/lib/actions/projects'
import { getOrCreateShareToken } from '@/lib/actions/share'
import { INSTALL_STAGES } from '@/lib/constants'
import { formatCurrency, formatDateShort } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Project, Payment, Installation, ActivityLog, Profile, Document, Material, TechnicianWithStatus, TechnicianAssignment, Technician, CustodyEntry, ProjectNote, PurchaseRequest } from '@/types/database'

type Tab = 'payments' | 'installation' | 'materials' | 'purchase' | 'board' | 'attachments' | 'activity'
type ActionDialog = 'complete' | 'cancel' | 'hold' | 'reactivate' | 'team' | 'editAmount' | 'editInfo' | 'delete' | null

function workloadLabel(count: number) {
  if (count === 0) return 'لا مشاريع نشطة'
  if (count === 1) return 'مشروع نشط واحد'
  return `${count} مشاريع نشطة`
}

function WorkloadChip({ count }: { count: number }) {
  const color = count === 0
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : count <= 2
    ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-red-50 text-red-700 border-red-200'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${color}`}>
      <Briefcase className="h-3 w-3" />
      {workloadLabel(count)}
    </span>
  )
}

interface ProjectDetailProps {
  project: Project
  payments: Payment[]
  installations: Installation[]
  attachments: Document[]
  material: Material | null
  activityLog: ActivityLog[]
  currentProfile: Profile
  coordinators: Pick<Profile, 'id' | 'full_name' | 'role'>[]
  salesEngineers: Pick<Profile, 'id' | 'full_name' | 'role'>[]
  installationPersons: Pick<Profile, 'id' | 'full_name' | 'role'>[]
  coordinatorWorkload: Record<string, number>
  salesWorkload: Record<string, number>
  installationWorkload: Record<string, number>
  technicians: TechnicianWithStatus[]
  technicianAssignments: (TechnicianAssignment & { technician?: Technician })[]
  custody: CustodyEntry[]
  notes: ProjectNote[]
  boardMembers: Pick<Profile, 'id' | 'full_name' | 'role'>[]
  purchaseRequests: PurchaseRequest[]
  brUsers: Pick<Profile, 'id' | 'full_name' | 'role'>[]
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'payments', label: 'الدفعات' },
  { id: 'installation', label: 'التركيب' },
  { id: 'materials', label: 'المواد' },
  { id: 'purchase', label: 'طلبات الشراء' },
  { id: 'board', label: 'المدونة' },
  { id: 'attachments', label: 'المرفقات' },
  { id: 'activity', label: 'سجل النشاط' },
]

type StageKey = 'contract' | 'payments' | 'materials_req' | 'materials_delivered' | 'install_scheduled' | 'install_done' | 'completed'

const STAGE_LABEL: Record<StageKey, string> = {
  contract: 'تم التعاقد',
  payments: 'الدفعة الأولى محصّلة',
  materials_req: 'المواد مطلوبة',
  materials_delivered: 'المواد موردة',
  install_scheduled: 'التركيب مجدول',
  install_done: 'التركيب منجز',
  completed: 'مكتمل',
}

const STEPS_FULL: { key: StageKey; label: string }[] = [
  { key: 'contract', label: 'التعاقد' },
  { key: 'payments', label: 'الدفعات' },
  { key: 'materials_req', label: 'طلب المواد' },
  { key: 'materials_delivered', label: 'توريد المواد' },
  { key: 'install_scheduled', label: 'التركيب مجدول' },
  { key: 'install_done', label: 'التركيب منجز' },
  { key: 'completed', label: 'الإغلاق' },
]

const STEPS_NO_INSTALL: { key: StageKey; label: string }[] = [
  { key: 'contract', label: 'التعاقد' },
  { key: 'payments', label: 'الدفعات' },
  { key: 'materials_req', label: 'طلب المواد' },
  { key: 'materials_delivered', label: 'توريد المواد' },
  { key: 'completed', label: 'الإغلاق' },
]

function getStageKey(
  payments: Payment[],
  installations: Installation[],
  material: Material | null,
  attachments: Document[]
): StageKey {
  const hasUpfrontPaid = payments.some(p => p.type === 'upfront' && p.status === 'paid')
  const hasInstallationPaid = payments.some(p => p.type === 'installation' && p.status === 'paid')
  const hasFinalPaid = payments.some(p => p.type === 'final' && p.status === 'paid')
  const hasScheduledInstall = installations.length > 0
  const installDone = installations.some(i => i.status === 'completed')

  const hasMaterialsRequest = attachments.some(a => a.type === 'materials_request')
    || (material?.items && material.items.length > 0)
  const hasDeliveryNote = attachments.some(a => a.type === 'delivery_note')

  if (installDone && (hasFinalPaid || hasInstallationPaid)) return 'completed'
  if (installDone) return 'install_done'
  if (hasScheduledInstall) return 'install_scheduled'
  if (hasDeliveryNote) return 'materials_delivered'
  if (hasMaterialsRequest) return 'materials_req'
  if (hasUpfrontPaid || hasFinalPaid) return 'payments'
  return 'contract'
}

export function ProjectDetail({
  project,
  payments,
  installations,
  attachments,
  material,
  activityLog,
  currentProfile,
  coordinators,
  salesEngineers,
  installationPersons,
  coordinatorWorkload,
  salesWorkload,
  installationWorkload,
  technicians,
  technicianAssignments,
  custody,
  notes,
  boardMembers,
  purchaseRequests,
  brUsers,
}: ProjectDetailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('payments')
  const [dialog, setDialog] = useState<ActionDialog>(null)
  // Open appointments / tasks / reminders — surfaced on the tab so nobody has to open it to know
  const openBoardItems = notes.filter((n) => n.kind !== 'note' && !n.done).length
  // Tabs for the installation-role view (their board was buried at page bottom)
  const [instTab, setInstTab] = useState<'installation' | 'board' | 'attachments'>('installation')
  const [cancelReason, setCancelReason] = useState('')
  const [newAmount, setNewAmount] = useState(project.total_amount?.toString() ?? '')
  const [editInfo, setEditInfo] = useState({
    project_name: project.project_name,
    client_name: project.client_name,
    location: project.location ?? '',
    customer_account_no: project.customer_account_no ?? '',
    has_installation: project.has_installation,
    total_amount: project.total_amount?.toString() ?? '',
    start_date: project.start_date ?? '',
    expected_end_date: project.expected_end_date ?? '',
  })
  const [teamCoordinatorId, setTeamCoordinatorId] = useState(project.coordinator_id ?? '')
  const [teamSalesId, setTeamSalesId] = useState(project.sales_engineer_id ?? '')
  const [teamInstallationId, setTeamInstallationId] = useState(project.installation_id ?? '')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const canShare = currentProfile.role === 'coordinator' || currentProfile.role === 'admin' || currentProfile.role === 'sales_engineer'

  function openShare() {
    setShareOpen(true)
    setCopied(false)
    if (shareUrl) return
    setShareLoading(true)
    startTransition(async () => {
      try {
        const result = await getOrCreateShareToken(project.id)
        if ('error' in result) { toast.error(result.error); setShareOpen(false) }
        else setShareUrl(`${window.location.origin}/track/${result.token}`)
      } catch { toast.error('حدث خطأ غير متوقع'); setShareOpen(false) }
      finally { setShareLoading(false) }
    })
  }

  function copyShare() {
    if (!shareUrl) return
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      toast.success('تم نسخ الرابط')
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => toast.error('تعذّر النسخ'))
  }

  const activePayments = payments.filter(p => p.status !== 'cancelled')
  const totalPaid = activePayments.reduce((sum, p) => sum + (p.paid_amount ?? 0), 0)
  const totalDue = activePayments.reduce((sum, p) => sum + (p.amount ?? 0), 0)
  // Collection is measured against the PROJECT VALUE
  const projectValue = project.total_amount != null && project.total_amount > 0 ? project.total_amount : totalDue
  const remainingValue = Math.max(0, projectValue - totalPaid)
  const collectionPct = projectValue > 0 ? Math.round((totalPaid / projectValue) * 100) : 0

  const isFullyPaid = project.total_amount != null && project.total_amount > 0 && totalPaid >= project.total_amount

  // Materials completion — derived from the workflow stage (per-item statuses
  // were removed with the SAP column layout)
  const MAT_PCT: Record<string, number> = { delivered: 100, ready: 60, partial: 50, preparing: 30, pending: 10 }
  const materialsPct = material ? (MAT_PCT[material.status] ?? 0) : 0

  // Installation completion — shown next to the financial boxes
  const installStagesData = installations[0]?.stages ?? {}
  const requiredInstallStages = INSTALL_STAGES.filter((s) => !s.optional)
  const installPct = project.has_installation
    ? Math.round((requiredInstallStages.filter((s) => installStagesData[s.key]?.done).length / requiredInstallStages.length) * 100)
    : null

  const stageKey = getStageKey(payments, installations, material, attachments)
  const stageLabel = STAGE_LABEL[stageKey]
  const lifecycleSteps = project.has_installation ? STEPS_FULL : STEPS_NO_INSTALL
  let currentStageIdx = lifecycleSteps.findIndex(s => s.key === stageKey)
  if (currentStageIdx === -1) {
    // installation key on a no-install project → treat as 'توريد المواد'
    currentStageIdx = stageKey === 'completed'
      ? lifecycleSteps.length - 1
      : lifecycleSteps.findIndex(s => s.key === 'materials_delivered')
  }
  const stage = currentStageIdx + 1

  // The coordinator is the operational manager: ANY coordinator (and admin)
  // can view and manage every project, not just the one they're assigned to.
  const canManage = currentProfile.role === 'admin' || currentProfile.role === 'coordinator'
  const isCoordinator = currentProfile.role === 'coordinator'
  const isActive = project.status === 'active'
  const isOnHold = project.status === 'on_hold'
  const isFinished = project.status === 'completed' || project.status === 'cancelled'
  const hasPendingPayments = payments.some(p => p.status === 'pending' || p.status === 'partial')

  function handleAction(action: ActionDialog) {
    if (action === 'cancel') setCancelReason('')
    if (action === 'editAmount') setNewAmount(project.total_amount?.toString() ?? '')
    if (action === 'editInfo') setEditInfo({
      project_name: project.project_name,
      client_name: project.client_name,
      location: project.location ?? '',
      customer_account_no: project.customer_account_no ?? '',
      has_installation: project.has_installation,
      total_amount: project.total_amount?.toString() ?? '',
      start_date: project.start_date ?? '',
      expected_end_date: project.expected_end_date ?? '',
    })
    setDialog(action)
  }

  function handleConfirm() {
    startTransition(async () => {
      try {
        let result: { error?: string } | undefined

        if (dialog === 'complete') {
          result = await updateProjectStatus(project.id, 'completed')
        } else if (dialog === 'hold') {
          result = await updateProjectStatus(project.id, 'on_hold')
        } else if (dialog === 'reactivate') {
          result = await updateProjectStatus(project.id, 'active')
        } else if (dialog === 'cancel') {
          if (!cancelReason.trim()) { toast.error('يرجى إدخال سبب الإلغاء'); return }
          result = await updateProjectStatus(project.id, 'cancelled', cancelReason.trim())
        } else if (dialog === 'team') {
          result = await updateProjectTeam(
            project.id,
            teamCoordinatorId || null,
            teamSalesId || null,
            teamInstallationId || null
          )
        } else if (dialog === 'editAmount') {
          const parsed = parseFloat(newAmount)
          if (isNaN(parsed) || parsed <= 0) { toast.error('يرجى إدخال قيمة صحيحة'); return }
          result = await updateProjectAmount(project.id, parsed)
        } else if (dialog === 'editInfo') {
          result = await updateProjectInfo(project.id, {
            project_name: editInfo.project_name,
            client_name: editInfo.client_name,
            location: editInfo.location || null,
            customer_account_no: editInfo.customer_account_no || null,
            has_installation: editInfo.has_installation,
            total_amount: editInfo.total_amount ? parseFloat(editInfo.total_amount) : null,
            start_date: editInfo.start_date || null,
            expected_end_date: editInfo.expected_end_date || null,
          })
        } else if (dialog === 'delete') {
          result = await deleteProject(project.id)
          if (!result?.error) {
            toast.success('تم حذف المشروع نهائياً')
            router.push('/projects')
            return
          }
        }

        if (result?.error) {
          toast.error(result.error)
        } else {
          const labels: Record<string, string> = {
            complete: 'تم إغلاق المشروع بنجاح',
            hold: 'تم تعليق المشروع',
            reactivate: 'تم إعادة تفعيل المشروع',
            cancel: 'تم إلغاء المشروع',
            team: 'تم تحديث الفريق',
            editAmount: 'تم تحديث قيمة المشروع',
            editInfo: 'تم تحديث معلومات المشروع',
          }
          toast.success(labels[dialog!] ?? 'تم التحديث')
          setDialog(null)
        }
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  // A sales engineer opening a project that isn't theirs: same treatment the
  // installation role already had. Without this they landed on the full layout
  // with every tab empty (the server refuses them the data), which reads as a
  // broken page rather than a permission boundary.
  if (currentProfile.role === 'sales_engineer' && project.sales_engineer_id !== currentProfile.id) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500 hover:text-gray-900">
              <ArrowRight className="h-4 w-4" />
              المشاريع
            </Button>
          </Link>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50">
            <Briefcase className="h-6 w-6 text-gray-400" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-1">
            <h1 data-no-i18n className="text-lg font-bold text-gray-900">{project.project_name}</h1>
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="text-sm font-semibold text-red-600 mb-1">ما عندك صلاحية للدخول لهذا المشروع</p>
          <p className="text-sm text-gray-500">
            المشروع يتابعه {project.sales_engineer?.full_name ?? 'مهندس مبيعات آخر'} — التفاصيل متاحة لمهندسه المعيّن فقط.
          </p>
        </div>
      </div>
    )
  }

  // Installation team sees ONLY the installation part of the project —
  // no payments, materials, attachments, financials or management actions.
  if (currentProfile.role === 'installation') {
    // A colleague's project: they may know it exists, nothing more.
    if (project.installation_id !== currentProfile.id) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Link href="/installation">
              <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500 hover:text-gray-900">
                <ArrowRight className="h-4 w-4" />
                التركيبات
              </Button>
            </Link>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50">
              <Hammer className="h-6 w-6 text-gray-400" />
            </div>
            <div className="flex items-center justify-center gap-2 mb-1">
              <h1 data-no-i18n className="text-lg font-bold text-gray-900">{project.project_name}</h1>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="text-sm font-semibold text-red-600 mb-1">ما عندك صلاحية للدخول لهذا المشروع</p>
            <p className="text-sm text-gray-500">
              المشروع يتابعه {project.installation_person?.full_name ?? 'مدير تركيبات آخر'} — التفاصيل متاحة لمديره المعيّن فقط.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        {/* Back */}
        <div className="flex items-center gap-2">
          <Link href="/installation">
            <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500 hover:text-gray-900">
              <ArrowRight className="h-4 w-4" />
              التركيبات
            </Button>
          </Link>
          <span className="text-gray-300">/</span>
          <span data-no-i18n className="text-sm text-gray-600 font-medium">{project.project_name}</span>
        </div>

        {/* Project header — the installation manager needs the full picture:
            client, team, dates and the money collected (client request). */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h1 data-no-i18n className="text-xl font-bold text-gray-900">{project.project_name}</h1>
            <ProjectStatusBadge status={project.status} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4 text-gray-400" />
              {project.client_name}
            </span>
            {project.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-gray-400" />
                {project.location}
              </span>
            )}
            {project.start_date && (
              <span className="flex items-center gap-1.5 font-bold text-brand-800">
                <Calendar className="h-4 w-4 text-brand-400" />
                <span dir="ltr">{formatDateShort(project.start_date)}</span>
                {project.expected_end_date && <span dir="ltr"> — {formatDateShort(project.expected_end_date)}</span>}
              </span>
            )}
          </div>

          {/* Team */}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {project.coordinator?.full_name && (
              <span className="rounded-full bg-blue-50 border border-blue-100 px-2.5 py-1 text-blue-700 font-medium">
                مهندس إدارة المشاريع: {project.coordinator.full_name}
              </span>
            )}
            {project.sales_engineer?.full_name && (
              <span className="rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-emerald-700 font-medium">
                مهندس المبيعات: {project.sales_engineer.full_name}
              </span>
            )}
            {project.customer_account_no && (
              <span className="rounded-full bg-gray-50 border border-gray-200 px-2.5 py-1 text-gray-600 font-medium" dir="ltr">
                {project.customer_account_no}
              </span>
            )}
          </div>

          {/* Financial overview — read-only */}
          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-center">
              <p className="text-sm font-bold text-emerald-700 leading-tight" dir="ltr">{formatCurrency(totalPaid)}</p>
              <p className="text-[11px] text-emerald-600 mt-0.5">المحصّل</p>
            </div>
            <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-center">
              <p className="text-sm font-bold text-amber-700 leading-tight" dir="ltr">{formatCurrency(remainingValue)}</p>
              <p className="text-[11px] text-amber-600 mt-0.5">المتبقي</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-center">
              <p className="text-sm font-bold text-gray-800 leading-tight" dir="ltr">{formatCurrency(projectValue)}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">قيمة المشروع</p>
            </div>
          </div>
          <div className="mt-2">
            <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
              <div className={`h-full rounded-full ${collectionPct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, collectionPct)}%` }} />
            </div>
            <p className="text-[11px] text-gray-400 mt-1">{collectionPct}% محصَّل من قيمة المشروع</p>
          </div>
        </div>

        {/* Tabs — the board/attachments were buried below the long installation
            section, so the team never found them. Now they're one tap away. */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-0 overflow-x-auto">
            {([
              { id: 'installation', label: 'التركيب' },
              { id: 'board', label: 'المدونة' },
              { id: 'attachments', label: 'المرفقات' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setInstTab(tab.id)}
                className={cn(
                  'px-5 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap',
                  instTab === tab.id
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
              >
                {tab.label}
                {tab.id === 'board' && openBoardItems > 0 && (
                  <span className="ms-1.5 inline-flex items-center justify-center rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                    {openBoardItems}
                  </span>
                )}
                {tab.id === 'attachments' && attachments.length > 0 && (
                  <span className="ms-1.5 inline-flex items-center justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                    {attachments.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {instTab === 'installation' && (
          project.has_installation ? (
            <InstallationTab installations={installations} projectId={project.id} canManage={false} currentProfile={currentProfile} material={material} technicians={technicians} technicianAssignments={technicianAssignments} custody={custody} />
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-8 text-center">
              <Hammer className="mx-auto h-8 w-8 text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">هذا المشروع بدون تركيب — لا توجد مهام تركيب.</p>
            </div>
          )
        )}

        {/* Board — for the whole team, installation included */}
        {instTab === 'board' && (
          <ProjectBoard projectId={project.id} notes={notes} members={boardMembers} currentProfile={currentProfile} />
        )}

        {/* Attachments + contract — view-only, no financials (client request) */}
        {instTab === 'attachments' && (
          <InstallationAttachments attachments={attachments} contractUrl={project.contract_url} projectName={project.project_name} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Back */}
      <div className="flex items-center gap-2">
        <Link href="/projects">
          <Button variant="ghost" size="sm" className="gap-1.5 text-gray-500 hover:text-gray-900">
            <ArrowRight className="h-4 w-4" />
            المشاريع
          </Button>
        </Link>
        <span className="text-gray-300">/</span>
        <span data-no-i18n className="text-sm text-gray-600 font-medium">{project.project_name}</span>
      </div>

      {/* Project Header */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <h1 data-no-i18n className="text-2xl font-bold text-gray-900">{project.project_name}</h1>
              <ProjectStatusBadge status={project.status} />
              {isFullyPaid && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 border border-emerald-200 px-3 py-1 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  مدفوع بالكامل
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-gray-500 mt-1">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-gray-400" />
                {project.client_name}
              </span>
              {project.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-gray-400" />
                  {project.location}
                </span>
              )}
              {project.customer_account_no && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-4 w-4 text-gray-400" />
                  حساب العميل: <span dir="ltr" className="font-medium">{project.customer_account_no}</span>
                </span>
              )}
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${project.has_installation ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                {project.has_installation ? 'مع تركيب' : 'بدون تركيب'}
              </span>
              {project.start_date && (
                <span className="flex items-center gap-1.5 font-bold text-brand-800">
                  <Calendar className="h-4 w-4 text-brand-400" />
                  <span dir="ltr">{formatDateShort(project.start_date)}</span>
                  {project.expected_end_date && <span dir="ltr"> — {formatDateShort(project.expected_end_date)}</span>}
                </span>
              )}
              <span className="flex items-center gap-1.5 font-semibold text-gray-700">
                <DollarSign className="h-4 w-4 text-gray-400" />
                {project.total_amount ? formatCurrency(project.total_amount) : <span className="text-gray-400 font-normal italic text-xs">القيمة غير محددة</span>}
                {canManage && (
                  <button
                    onClick={() => handleAction('editAmount')}
                    className="ms-1 text-gray-400 hover:text-brand-600 transition-colors"
                    title="تعديل القيمة"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
              {project.contract_url && (
                <a href={project.contract_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-brand-600 hover:text-brand-700 hover:underline font-medium">
                  <FileText className="h-4 w-4" />
                  العقد
                </a>
              )}
            </div>

            {/* Team chips */}
            {(project.coordinator || project.sales_engineer || project.installation_person) && (
              <div className="flex flex-wrap gap-2 mt-3">
                {project.coordinator && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-1 text-xs">
                    <span className="font-bold text-blue-500 shrink-0">مهندس إدارة المشاريع</span>
                    <span className="h-1 w-1 rounded-full bg-blue-300 shrink-0" />
                    <span className="text-blue-800 font-medium">{project.coordinator.full_name}</span>
                  </span>
                )}
                {project.sales_engineer && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-xs">
                    <span className="font-bold text-emerald-600 shrink-0">المبيعات</span>
                    <span className="h-1 w-1 rounded-full bg-emerald-300 shrink-0" />
                    <span className="text-emerald-800 font-medium">{project.sales_engineer.full_name}</span>
                  </span>
                )}
                {project.installation_person && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-purple-50 border border-purple-100 px-2.5 py-1 text-xs">
                    <span className="font-bold text-purple-600 shrink-0">التركيب</span>
                    <span className="h-1 w-1 rounded-full bg-purple-300 shrink-0" />
                    <span className="text-purple-800 font-medium">{project.installation_person.full_name}</span>
                  </span>
                )}
              </div>
            )}

            {/* Cancellation reason */}
            {project.status === 'cancelled' && project.cancellation_reason && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-2 text-sm text-red-700">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span><strong>سبب الإلغاء:</strong> {project.cancellation_reason}</span>
              </div>
            )}
          </div>

          {/* Financial summary — wraps into a 2-col grid on phones so nothing clips */}
          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:gap-3 sm:shrink-0">
            <div className={`rounded-xl px-4 py-3 text-center min-w-[100px] ${isFullyPaid ? 'bg-emerald-50' : 'bg-blue-50'}`}>
              <p className={`text-xs font-medium ${isFullyPaid ? 'text-emerald-600' : 'text-blue-600'}`}>المحصّل</p>
              <p className={`text-lg font-bold mt-0.5 ${isFullyPaid ? 'text-emerald-700' : 'text-blue-700'}`}>{formatCurrency(totalPaid)}</p>
              <p className={`text-xs mt-0.5 ${isFullyPaid ? 'text-emerald-500' : 'text-blue-500'}`}>{collectionPct}%</p>
            </div>
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-center min-w-[100px]">
              <p className="text-xs text-amber-600 font-medium">المتبقي</p>
              <p className="text-lg font-bold text-amber-700 mt-0.5">{formatCurrency(remainingValue)}</p>
              <p className="text-xs text-amber-500 mt-0.5">من قيمة المشروع</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-center min-w-[100px]">
              <p className="text-xs text-gray-500 font-medium">الإجمالي</p>
              <p className="text-lg font-bold text-gray-700 mt-0.5">{formatCurrency(projectValue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">قيمة المشروع</p>
            </div>
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-center min-w-[100px]">
              <p className="text-xs text-amber-600 font-medium">المواد</p>
              <p className="text-lg font-bold text-amber-700 mt-0.5">{materialsPct}%</p>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-amber-100 overflow-hidden">
                <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${materialsPct}%` }} />
              </div>
            </div>
            {installPct !== null && (
              <div className="rounded-xl bg-purple-50 px-4 py-3 text-center min-w-[100px]">
                <p className="text-xs text-purple-600 font-medium">التركيب</p>
                <p className="text-lg font-bold text-purple-700 mt-0.5">{installPct}%</p>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-purple-100 overflow-hidden">
                  <div className="h-full rounded-full bg-purple-600 transition-all" style={{ width: `${installPct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Collection progress bar */}
        {projectValue > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                نسبة التحصيل من قيمة المشروع
              </span>
              <span className="font-semibold text-gray-700">{collectionPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full transition-all duration-500 ${isFullyPaid ? 'bg-emerald-500' : 'bg-blue-500'}`}
                style={{ width: `${Math.min(collectionPct, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Share with client (coordinator / sales / admin) */}
        {canShare && (
          <div className={`mt-5 flex flex-wrap gap-2 ${canManage ? '' : 'border-t border-gray-100 pt-5'}`}>
            <Button size="sm" variant="outline" onClick={openShare} className="gap-1.5 text-brand-700 border-brand-200 hover:bg-brand-50">
              <Share2 className="h-4 w-4" />
              مشاركة مع العميل
            </Button>
          </div>
        )}

        {/* Action buttons */}
        {canManage && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-5">
            <Link href={`/projects/${project.id}/summary`}>
              <Button size="sm" variant="outline"
                className="gap-1.5 text-brand-700 border-brand-200 hover:bg-brand-50">
                <ClipboardList className="h-4 w-4" />
                ملخص المشروع
              </Button>
            </Link>
            {canManage && !isFinished && (
              <Button size="sm" variant="outline" onClick={() => handleAction('editInfo')} className="gap-1.5">
                <Edit2 className="h-4 w-4" />
                تعديل المعلومات
              </Button>
            )}
            {(currentProfile.role === 'admin' || (isCoordinator && !isFinished)) && (
              <Button size="sm" variant="outline" onClick={() => handleAction('team')} className="gap-1.5">
                <Users className="h-4 w-4" />
                تعديل الفريق
              </Button>
            )}
            {!isFinished && (
              <>
                {isActive && (
                  <>
                    <Button size="sm" variant="success" onClick={() => handleAction('complete')} className="gap-1.5">
                      <CheckCircle2 className="h-4 w-4" />
                      إغلاق المشروع
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleAction('hold')}
                      className="gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50">
                      <PauseCircle className="h-4 w-4" />
                      تعليق المشروع
                    </Button>
                  </>
                )}
                {isOnHold && (
                  <Button size="sm" variant="outline" onClick={() => handleAction('reactivate')}
                    className="gap-1.5 text-brand-700 border-brand-200 hover:bg-brand-50">
                    <PlayCircle className="h-4 w-4" />
                    إعادة تفعيل
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => handleAction('cancel')}
                  className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
                  <XCircle className="h-4 w-4" />
                  إلغاء المشروع
                </Button>
              </>
            )}
            {/* Delete — admin or coordinator, cancelled or on_hold only */}
            {canManage && (project.status === 'cancelled' || project.status === 'on_hold') && (
              <Button size="sm" variant="outline" onClick={() => handleAction('delete')}
                className="gap-1.5 text-red-700 border-red-300 hover:bg-red-50 ms-auto">
                <Trash2 className="h-4 w-4" />
                حذف المشروع نهائياً
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Lifecycle Progress */}
      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">مرحلة المشروع</h3>
          <span className="text-xs font-semibold rounded-full px-3 py-1 text-brand-600 bg-brand-50">
            {stageLabel}
          </span>
        </div>
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {lifecycleSteps.map((step, idx) => {
            const stepNum = idx + 1
            const isDone = stepNum < stage
            const isCurrent = stepNum === stage
            return (
              <div key={step.key} className="flex items-center shrink-0">
                <div className="flex flex-col items-center gap-1.5">
                  <div className={cn(
                    'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors',
                    isDone ? 'bg-emerald-500 border-emerald-500 text-white'
                      : isCurrent ? 'bg-brand-600 border-brand-600 text-white'
                      : 'bg-white border-gray-200 text-gray-400'
                  )}>
                    {isDone ? '✓' : stepNum}
                  </div>
                  <span className={cn(
                    'text-[10px] font-medium whitespace-nowrap',
                    isDone ? 'text-emerald-600' : isCurrent ? 'text-brand-600' : 'text-gray-400'
                  )}>
                    {step.label}
                  </span>
                </div>
                {idx < lifecycleSteps.length - 1 && (
                  <div className={cn('h-0.5 w-8 mx-1 mb-4', stepNum < stage ? 'bg-emerald-400' : 'bg-gray-200')} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0 overflow-x-auto">
          {TABS
            .filter((tab) => tab.id !== 'installation' || project.has_installation)
            .filter((tab) => tab.id !== 'purchase' || canManage || currentProfile.role === 'sales_engineer')
            .map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'px-5 py-3 text-sm font-medium transition-all border-b-2 whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {tab.label}
              {tab.id === 'attachments' && attachments.length > 0 && (
                <span className="ms-1.5 inline-flex items-center justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                  {attachments.length}
                </span>
              )}
              {tab.id === 'board' && openBoardItems > 0 && (
                <span className="ms-1.5 inline-flex items-center justify-center rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                  {openBoardItems}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'payments' && (
          <PaymentsTab payments={payments} projectId={project.id} canManage={canManage} projectTotal={project.total_amount} attachments={attachments}
            hasInstallation={project.has_installation}
            canConfirmSales={currentProfile.role === 'sales_engineer' && project.sales_engineer_id === currentProfile.id}
            canPrintInvoice={['admin', 'coordinator', 'sales_engineer'].includes(currentProfile.role)}
            projectName={project.project_name} clientName={project.client_name} />
        )}
        {activeTab === 'installation' && (
          <InstallationTab installations={installations} projectId={project.id} canManage={canManage} currentProfile={currentProfile} material={material} technicians={technicians} technicianAssignments={technicianAssignments} custody={custody} />
        )}
        {activeTab === 'materials' && (
          <MaterialsTab material={material} attachments={attachments} projectId={project.id} canManage={canManage} payments={payments} projectName={project.project_name} clientName={project.client_name} />
        )}
        {activeTab === 'attachments' && (
          <AttachmentsTab
            attachments={attachments}
            projectId={project.id}
            project={project}
            payments={payments}
            canManage={canManage}
          />
        )}
        {activeTab === 'purchase' && (canManage || currentProfile.role === 'sales_engineer') && (
          <PurchaseBoard
            requests={purchaseRequests}
            users={brUsers}
            projectNames={[project.project_name]}
            currentProfile={currentProfile}
            lockedProjectName={project.project_name}
            readOnly={!canManage}
          />
        )}
        {activeTab === 'board' && (
          <ProjectBoard projectId={project.id} notes={notes} members={boardMembers} currentProfile={currentProfile} />
        )}
        {activeTab === 'activity' && <ActivityTab activityLog={activityLog} />}
      </div>

      {/* ── Edit Project Info dialog ── */}
      <Dialog open={dialog === 'editInfo'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>تعديل معلومات المشروع</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <div className="p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit_project_name">اسم المشروع *</Label>
              <Input id="edit_project_name" value={editInfo.project_name}
                onChange={e => setEditInfo(p => ({ ...p, project_name: e.target.value }))}
                placeholder="اسم المشروع" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_client_name">اسم العميل *</Label>
              <Input id="edit_client_name" value={editInfo.client_name}
                onChange={e => setEditInfo(p => ({ ...p, client_name: e.target.value }))}
                placeholder="اسم العميل" required />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit_location">موقع المشروع</Label>
              <Input id="edit_location" value={editInfo.location}
                onChange={e => setEditInfo(p => ({ ...p, location: e.target.value }))}
                placeholder="الرياض — حي النخيل" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_customer_account">رقم حساب العميل الداخلي</Label>
              <Input id="edit_customer_account" dir="ltr" className="text-start" value={editInfo.customer_account_no}
                onChange={e => setEditInfo(p => ({ ...p, customer_account_no: e.target.value }))}
                placeholder="للمحاسبة" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>نوع المشروع</Label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setEditInfo(p => ({ ...p, has_installation: true }))}
                className={`rounded-xl border p-2.5 text-sm font-medium transition-all ${editInfo.has_installation ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/15' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                مع تركيب
              </button>
              <button type="button" onClick={() => setEditInfo(p => ({ ...p, has_installation: false }))}
                className={`rounded-xl border p-2.5 text-sm font-medium transition-all ${!editInfo.has_installation ? 'border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500/15' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                بدون تركيب
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit_total_amount">القيمة الإجمالية (ريال)</Label>
            <Input id="edit_total_amount" type="number" min="0" step="0.01"
              value={editInfo.total_amount}
              onChange={e => setEditInfo(p => ({ ...p, total_amount: e.target.value }))}
              placeholder="0.00" dir="ltr" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit_start_date">تاريخ البداية</Label>
              <Input id="edit_start_date" type="date" dir="ltr"
                value={editInfo.start_date}
                onChange={e => setEditInfo(p => ({ ...p, start_date: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit_end_date">تاريخ الانتهاء المتوقع</Label>
              <Input id="edit_end_date" type="date" dir="ltr"
                value={editInfo.expected_end_date}
                onChange={e => setEditInfo(p => ({ ...p, expected_end_date: e.target.value }))} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
          <Button loading={isPending} onClick={handleConfirm}
            disabled={!editInfo.project_name.trim() || !editInfo.client_name.trim()}>
            <Edit2 className="h-4 w-4" />
            حفظ التغييرات
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Edit Amount dialog ── */}
      <Dialog open={dialog === 'editAmount'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>تعديل قيمة المشروع</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            {project.total_amount && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm text-gray-600">
                القيمة الحالية: <strong className="text-gray-900">{formatCurrency(project.total_amount)}</strong>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>القيمة الجديدة (ريال)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
          <Button loading={isPending} onClick={handleConfirm} disabled={!newAmount || parseFloat(newAmount) <= 0}>
            <Edit2 className="h-4 w-4" />
            حفظ القيمة
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Close project dialog ── */}
      <Dialog open={dialog === 'complete'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>إغلاق المشروع</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <DialogContent>
          {hasPendingPayments ? (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>يوجد دفعات لم تُسدَّد بعد. لا يمكن إغلاق المشروع حتى تُحصَّل جميع الدفعات.</span>
            </div>
          ) : (
            <p className="text-sm text-gray-600">
              هل أنت متأكد من إغلاق المشروع <strong data-no-i18n>{project.project_name}</strong> وتحديد حالته إلى &ldquo;مكتمل&rdquo;؟
              لن تتمكن من إجراء تغييرات بعد الإغلاق.
            </p>
          )}
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
          <Button variant="success" loading={isPending} onClick={handleConfirm} disabled={hasPendingPayments}>
            <CheckCircle2 className="h-4 w-4" />
            تأكيد الإغلاق
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Hold dialog ── */}
      <Dialog open={dialog === 'hold'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>تعليق المشروع</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <DialogContent>
          <p className="text-sm text-gray-600">
            سيتم تعليق مشروع <strong data-no-i18n>{project.project_name}</strong> مؤقتاً. يمكنك إعادة تفعيله في أي وقت.
          </p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
          <Button loading={isPending} onClick={handleConfirm} className="bg-amber-600 hover:bg-amber-700 text-white">
            <PauseCircle className="h-4 w-4" />
            تعليق المشروع
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Reactivate dialog ── */}
      <Dialog open={dialog === 'reactivate'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>إعادة تفعيل المشروع</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <DialogContent>
          <p className="text-sm text-gray-600">
            هل تريد إعادة تفعيل مشروع <strong data-no-i18n>{project.project_name}</strong> والعودة لحالة &ldquo;نشط&rdquo;؟
          </p>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
          <Button loading={isPending} onClick={handleConfirm}>
            <PlayCircle className="h-4 w-4" />
            إعادة التفعيل
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Edit team dialog ── */}
      <Dialog open={dialog === 'team'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>تعديل فريق المشروع</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <DialogContent>
          <div className="space-y-5">
            {currentProfile.role === 'admin' && (
              <div className="space-y-1.5">
                <Label>مهندس إدارة المشاريع</Label>
                <Select value={teamCoordinatorId} onChange={(e) => setTeamCoordinatorId(e.target.value)} placeholder="اختر مهندس إدارة المشاريع">
                  <option value="">— بدون مهندس إدارة مشاريع —</option>
                  {coordinators.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name} — {workloadLabel(coordinatorWorkload[c.id] ?? 0)}</option>
                  ))}
                </Select>
                {teamCoordinatorId && <WorkloadChip count={coordinatorWorkload[teamCoordinatorId] ?? 0} />}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>مهندس المبيعات</Label>
              <Select value={teamSalesId} onChange={(e) => setTeamSalesId(e.target.value)} placeholder="اختر المهندس">
                <option value="">— بدون مهندس —</option>
                {salesEngineers.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} — {workloadLabel(salesWorkload[s.id] ?? 0)}</option>
                ))}
              </Select>
              {teamSalesId && <WorkloadChip count={salesWorkload[teamSalesId] ?? 0} />}
            </div>

            <div className="space-y-1.5">
              <Label>مسؤول التركيب</Label>
              <Select value={teamInstallationId} onChange={(e) => setTeamInstallationId(e.target.value)} placeholder="اختر مسؤول التركيب">
                <option value="">— بدون مسؤول —</option>
                {installationPersons.map((i) => (
                  <option key={i.id} value={i.id}>{i.full_name} — {workloadLabel(installationWorkload[i.id] ?? 0)}</option>
                ))}
              </Select>
              {teamInstallationId && <WorkloadChip count={installationWorkload[teamInstallationId] ?? 0} />}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
          <Button loading={isPending} onClick={handleConfirm}>
            <Users className="h-4 w-4" />
            حفظ التغييرات
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Cancel dialog ── */}
      <Dialog open={dialog === 'cancel'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>إلغاء المشروع</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>هذا الإجراء لا يُمكن التراجع عنه. سيتم أرشفة المشروع ولن يُحذف من النظام.</span>
            </div>
            <div className="space-y-1.5">
              <Label>سبب الإلغاء *</Label>
              <Input
                placeholder="مثال: العميل ألغى الطلب / توقف التمويل..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>رجوع</Button>
          <Button loading={isPending} onClick={handleConfirm} disabled={!cancelReason.trim()}
            className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-40">
            <XCircle className="h-4 w-4" />
            تأكيد الإلغاء
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Delete project dialog ── */}
      <Dialog open={dialog === 'delete'} onClose={() => setDialog(null)}>
        <DialogHeader>
          <DialogTitle>حذف المشروع نهائياً</DialogTitle>
          <DialogClose onClose={() => setDialog(null)} />
        </DialogHeader>
        <DialogContent>
          <div className="space-y-3">
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-800">
              <Trash2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                سيتم حذف مشروع <strong data-no-i18n>{project.project_name}</strong> بشكل نهائي وكامل — الدفعات، الملفات، سجل النشاطات.
                <br /><strong>لا يمكن التراجع عن هذا الإجراء.</strong>
              </span>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialog(null)}>إلغاء</Button>
          <Button loading={isPending} onClick={handleConfirm}
            className="bg-red-600 hover:bg-red-700 text-white">
            <Trash2 className="h-4 w-4" />
            حذف نهائياً
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Share with client dialog ── */}
      <Dialog open={shareOpen} onClose={() => setShareOpen(false)}>
        <DialogHeader>
          <DialogTitle>مشاركة المشروع مع العميل</DialogTitle>
          <DialogClose onClose={() => setShareOpen(false)} />
        </DialogHeader>
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              أرسل هذا الرابط للعميل ليتابع مراحل مشروعه. الصفحة <strong>للعرض فقط</strong> — لا يستطيع تعديل أو الوصول لأي بيانات داخلية.
            </p>
            {shareLoading ? (
              <div className="flex items-center justify-center py-6 text-sm text-gray-400">
                <Share2 className="h-4 w-4 animate-pulse me-2" /> جاري تجهيز الرابط…
              </div>
            ) : shareUrl ? (
              <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-2">
                <input
                  readOnly
                  value={shareUrl}
                  dir="ltr"
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-transparent px-2 text-sm text-gray-700 outline-none truncate"
                />
                <Button size="sm" onClick={copyShare} className="shrink-0">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'تم النسخ' : 'نسخ'}
                </Button>
              </div>
            ) : null}
            {shareUrl && (
              <a href={shareUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700">
                <Share2 className="h-3.5 w-3.5" /> معاينة الصفحة كما يراها العميل
              </a>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShareOpen(false)}>إغلاق</Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
