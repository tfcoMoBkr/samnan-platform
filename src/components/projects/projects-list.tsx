'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import Link from 'next/link'
import {
  Plus, FolderOpen, Building2, Calendar, DollarSign, ChevronLeft,
  Search, MapPin, Users, ChevronDown, X, Check, Receipt,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProjectStatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { formatCurrency, formatDateShort } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { STATUS_LABELS } from '@/lib/constants'
import {
  BILLING_STATES, BILLING_LABELS, BILLING_CHIP, BILLING_CHIP_ACTIVE, type BillingState,
} from '@/lib/billing'
import type { Project, Profile, ProjectStatus } from '@/types/database'

export interface ProjectProgress {
  overall: number
  collection: number
  materials: number
  installation: number | null
}

interface ProjectsListProps {
  projects: Project[]
  myProjectIds: Set<string>
  currentProfile: Profile
  canCreate: boolean
  progress?: Record<string, ProjectProgress>
  /** invoicing/collection states present on each project's payments */
  billing?: Record<string, string[]>
  /** preselected billing filter, e.g. arriving from a dashboard chip */
  initialBilling?: BillingState | null
}

type View = 'mine' | 'all'

const STATUS_FILTERS: { value: ProjectStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'active', label: STATUS_LABELS.active },
  { value: 'on_hold', label: STATUS_LABELS.on_hold },
  { value: 'completed', label: STATUS_LABELS.completed },
  { value: 'cancelled', label: STATUS_LABELS.cancelled },
]

function projectTeam(p: Project) {
  return [p.coordinator, p.sales_engineer, p.installation_person].filter(Boolean) as Profile[]
}

export function ProjectsList({ projects, myProjectIds, currentProfile, canCreate, progress, billing, initialBilling = null }: ProjectsListProps) {
  const isAdmin = currentProfile.role === 'admin'
  const [view, setView] = useState<View>('mine')
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedCities, setSelectedCities] = useState<string[]>([])
  const [selectedPeople, setSelectedPeople] = useState<string[]>([])
  const [billingFilter, setBillingFilter] = useState<BillingState | null>(initialBilling)
  // User-controlled count: a number shows that many; 'all' shows everything.
  const [limit, setLimit] = useState<number | 'all'>(12)

  const myProjects = useMemo(() => projects.filter((p) => myProjectIds.has(p.id)), [projects, myProjectIds])
  const baseList = isAdmin ? projects : view === 'mine' ? myProjects : projects

  // Unique cities + people derived from the visible base list
  const cityOptions = useMemo(() => {
    const set = new Set<string>()
    baseList.forEach((p) => { if (p.location?.trim()) set.add(p.location.trim()) })
    return Array.from(set).sort()
  }, [baseList])

  const peopleOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    baseList.forEach((p) => projectTeam(p).forEach((m) => {
      if (!map.has(m.id)) map.set(m.id, { id: m.id, name: m.full_name })
    }))
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [baseList])

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    return baseList.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false

      if (selectedCities.length > 0 && !(p.location && selectedCities.includes(p.location.trim()))) return false

      if (billingFilter && !(billing?.[p.id] ?? []).includes(billingFilter)) return false

      if (selectedPeople.length > 0) {
        const teamIds = projectTeam(p).map((m) => m.id)
        if (!selectedPeople.some((id) => teamIds.includes(id))) return false
      }

      if (q) {
        const haystack = [
          p.project_name, p.client_name, p.location ?? '', p.customer_account_no ?? '',
          ...projectTeam(p).map((m) => m.full_name),
        ].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [baseList, statusFilter, selectedCities, selectedPeople, search, billingFilter, billing])

  // User-controlled number of projects shown
  const paged = limit === 'all' ? displayed : displayed.slice(0, limit)

  const myCount = myProjects.length
  const allCount = projects.length
  const hasActiveFilters = search.trim() !== '' || selectedCities.length > 0 || selectedPeople.length > 0 || billingFilter !== null

  function clearAll() {
    setSearch('')
    setSelectedCities([])
    setSelectedPeople([])
    setBillingFilter(null)
  }

  return (
    <div className="space-y-4">
      {/* View switcher — hidden for admin */}
      {!isAdmin && (
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1 w-fit">
          {(['mine', 'all'] as View[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              )}
            >
              {v === 'mine' ? 'مشاريعي' : 'كل المشاريع'}
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-xs font-bold leading-none',
                view === v ? 'bg-brand-600 text-white' : 'bg-gray-300 text-gray-600'
              )}>
                {v === 'mine' ? myCount : allCount}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Search + filters bar */}
      <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          {/* Search input */}
          <div className="relative flex-1">
            <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث بالاسم، العميل، رقم حساب العميل، المدينة، أو المهندس..."
              className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50/50 ps-10 pe-9 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/15 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute top-1/2 -translate-y-1/2 end-3 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* City + People dropdowns */}
          <div className="flex items-center gap-2">
            <MultiSelect
              icon={<MapPin className="h-4 w-4" />}
              label="المدينة"
              options={cityOptions.map((c) => ({ value: c, label: c }))}
              selected={selectedCities}
              onChange={setSelectedCities}
              emptyText="لا توجد مدن"
            />
            <MultiSelect
              icon={<Users className="h-4 w-4" />}
              label="المهندس"
              options={peopleOptions.map((p) => ({ value: p.id, label: p.name }))}
              selected={selectedPeople}
              onChange={setSelectedPeople}
              emptyText="لا يوجد أعضاء فريق"
            />
          </div>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-50 pt-3">
            <span className="text-xs font-medium text-gray-400">الفلاتر:</span>
            {selectedCities.map((c) => (
              <FilterChip key={`c-${c}`} label={c} icon={<MapPin className="h-3 w-3" />}
                onRemove={() => setSelectedCities((prev) => prev.filter((x) => x !== c))} />
            ))}
            {selectedPeople.map((id) => {
              const person = peopleOptions.find((p) => p.id === id)
              return (
                <FilterChip key={`p-${id}`} label={person?.name ?? ''} icon={<Users className="h-3 w-3" />}
                  onRemove={() => setSelectedPeople((prev) => prev.filter((x) => x !== id))} />
              )
            })}
            {search.trim() && (
              <FilterChip label={`"${search.trim()}"`} icon={<Search className="h-3 w-3" />}
                onRemove={() => setSearch('')} />
            )}
            {billingFilter && (
              <FilterChip label={BILLING_LABELS[billingFilter]} icon={<Receipt className="h-3 w-3" />}
                onRemove={() => setBillingFilter(null)} />
            )}
            <button onClick={clearAll}
              className="ms-auto text-xs font-medium text-red-500 hover:text-red-600 hover:underline">
              مسح الكل
            </button>
          </div>
        )}
      </div>

      {/* Invoicing / collection filter — permanently visible, all states shown
          even at zero so the row never shifts around under the user. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-gray-400">حالة الفوترة والتحصيل:</span>
        {BILLING_STATES.map((state) => {
          const count = baseList.filter((p) => (billing?.[p.id] ?? []).includes(state)).length
          const active = billingFilter === state
          return (
            <button key={state} onClick={() => setBillingFilter(active ? null : state)}
              className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                active ? BILLING_CHIP_ACTIVE[state]
                  : count === 0 ? 'bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300'
                  : `${BILLING_CHIP[state]} hover:opacity-80`)}>
              {BILLING_LABELS[state]} <span className="opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-all',
              statusFilter === f.value
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800'
            )}
          >
            {f.label}
            {f.value !== 'all' && (
              <span className={cn(
                'ms-1.5 rounded-full px-1 text-[10px] font-bold',
                statusFilter === f.value ? 'text-white/80' : 'text-gray-400'
              )}>
                {baseList.filter((p) => p.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Count + how-many-to-show selector */}
      {displayed.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500">
            عرض <span className="font-bold text-gray-700">{paged.length}</span> من{' '}
            <span className="font-bold text-gray-700">{displayed.length}</span>
            {hasActiveFilters ? ' نتيجة' : ' مشروع'}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">عرض كم مشروع؟</span>
            <input
              type="number"
              min={1}
              value={limit === 'all' ? '' : limit}
              placeholder="الكل"
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                setLimit(!e.target.value || isNaN(v) || v <= 0 ? 'all' : v)
              }}
              className="h-9 w-20 rounded-lg border border-gray-200 bg-white px-2 text-center text-sm text-gray-800 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/15"
              dir="ltr"
              title="اكتب العدد الذي تريد عرضه، أو اتركه فارغاً لعرض الكل"
            />
            <button
              onClick={() => setLimit('all')}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                limit === 'all' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:text-gray-800'
              )}
            >
              الكل
            </button>
          </div>
        </div>
      )}

      {/* Cards grid */}
      {displayed.length === 0 ? (
        // A billing filter that matches nothing gets its own plain message —
        // "لا يوجد" reads better than a generic no-results screen when the user
        // deliberately asked for one invoicing state.
        billingFilter ? (
          <EmptyState
            message="لا يوجد"
            description={`لا توجد مشاريع بحالة «${BILLING_LABELS[billingFilter]}»`}
            icon={<Receipt className="h-8 w-8 text-gray-400" />}
            action={<Button variant="outline" size="sm" onClick={() => setBillingFilter(null)}>عرض الكل</Button>}
          />
        ) : hasActiveFilters ? (
          <EmptyState
            message="لا توجد نتائج مطابقة"
            description="جرّب تعديل كلمات البحث أو الفلاتر"
            icon={<Search className="h-8 w-8 text-gray-400" />}
            action={<Button variant="outline" size="sm" onClick={clearAll}>مسح الفلاتر</Button>}
          />
        ) : (
          <EmptyState
            message={statusFilter !== 'all' ? `لا توجد مشاريع ${STATUS_LABELS[statusFilter as ProjectStatus]}` : view === 'mine' ? 'لا توجد مشاريع مخصصة لك' : 'لا توجد مشاريع بعد'}
            description={
              view === 'mine' && statusFilter === 'all'
                ? 'ستظهر هنا المشاريع التي أنت مسؤول عنها'
                : canCreate && statusFilter === 'all'
                ? 'أنشئ مشروعاً جديداً للبدء'
                : undefined
            }
            icon={<FolderOpen className="h-8 w-8 text-gray-400" />}
            action={
              view === 'mine' && statusFilter === 'all' && !isAdmin ? (
                <Button variant="outline" size="sm" onClick={() => setView('all')}>
                  عرض كل المشاريع
                </Button>
              ) : canCreate && statusFilter === 'all' ? (
                <Link href="/projects/new">
                  <Button>
                    <Plus className="h-4 w-4" />
                    مشروع جديد
                  </Button>
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {paged.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isMine={myProjectIds.has(project.id)}
              showMineTag={!isAdmin && view === 'all'}
              progress={progress?.[project.id]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Multi-select dropdown (checkboxes + internal search) ── */
function MultiSelect({
  icon, label, options, selected, onChange, emptyText,
}: {
  icon: React.ReactNode
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (v: string[]) => void
  emptyText: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-11 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors whitespace-nowrap',
          selected.length > 0
            ? 'border-brand-300 bg-brand-50 text-brand-700'
            : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
        )}
      >
        <span className={selected.length > 0 ? 'text-brand-600' : 'text-gray-400'}>{icon}</span>
        {label}
        {selected.length > 0 && (
          <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {selected.length}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl">
          {options.length > 6 && (
            <div className="border-b border-gray-50 p-2">
              <div className="relative">
                <Search className="absolute top-1/2 -translate-y-1/2 start-2.5 h-3.5 w-3.5 text-gray-400" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`ابحث في ${label}...`}
                  className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 ps-8 pe-2 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
                />
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-gray-400">{query ? 'لا توجد نتائج' : emptyText}</p>
            ) : (
              filtered.map((o) => {
                const checked = selected.includes(o.value)
                return (
                  <button
                    key={o.value}
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <span className={cn(
                      'flex h-4 w-4 items-center justify-center rounded border shrink-0 transition-colors',
                      checked ? 'border-brand-600 bg-brand-600' : 'border-gray-300 bg-white'
                    )}>
                      {checked && <Check className="h-3 w-3 text-white" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                )
              })
            )}
          </div>

          {selected.length > 0 && (
            <div className="border-t border-gray-50 p-1.5">
              <button onClick={() => onChange([])}
                className="w-full rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
                مسح التحديد
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MiniMeter({ label, pct }: { label: string; pct: number }) {
  const done = pct >= 100
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-gray-500">{label}</span>
        <span className={`text-[10px] font-bold ${done ? 'text-emerald-600' : 'text-gray-600'}`}>{pct}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

function FilterChip({ label, icon, onRemove }: { label: string; icon: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
      <span className="text-gray-400">{icon}</span>
      <span className="max-w-[140px] truncate">{label}</span>
      <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors">
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

function ProjectCard({
  project,
  isMine,
  showMineTag,
  progress,
}: {
  project: Project
  isMine: boolean
  showMineTag: boolean
  progress?: ProjectProgress
}) {
  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <div className="flex flex-col h-full rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md hover:border-brand-200 hover:-translate-y-0.5">

        {/* Header row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 data-no-i18n className="text-[15px] font-bold text-gray-900 leading-snug group-hover:text-brand-700 transition-colors line-clamp-2">
              {project.project_name}
            </h3>
            <p className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span data-no-i18n className="truncate">{project.client_name}</span>
            </p>
            {project.location && (
              <p className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{project.location}</span>
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <ProjectStatusBadge status={project.status} />
            {showMineTag && isMine && (
              <span className="rounded-full bg-brand-50 border border-brand-100 px-2 py-0.5 text-[10px] font-bold text-brand-700">
                مشروعي
              </span>
            )}
          </div>
        </div>

        {/* Amount + Date row */}
        <div className="flex items-center justify-between mb-4">
          {project.total_amount ? (
            <span className="flex items-center gap-1.5 text-sm font-bold text-gray-800">
              <DollarSign className="h-3.5 w-3.5 text-gray-400" />
              {formatCurrency(project.total_amount)}
            </span>
          ) : (
            <span className="text-xs text-gray-400 italic">القيمة غير محددة</span>
          )}
          {project.start_date && (
            <span className="flex items-center gap-1 text-xs font-bold text-brand-800">
              <Calendar className="h-3 w-3 shrink-0 text-brand-400" />
              <span dir="ltr">{formatDateShort(project.start_date)}</span>
              {project.expected_end_date && (
                <>
                  <span className="text-gray-300 mx-0.5">—</span>
                  <span dir="ltr">{formatDateShort(project.expected_end_date)}</span>
                </>
              )}
            </span>
          )}
        </div>

        {/* Team chips */}
        <div className="flex flex-wrap gap-1.5 mb-4 flex-1">
          {project.coordinator && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 border border-blue-100 px-2 py-1 text-xs">
              <span className="font-bold text-blue-500 text-[10px] shrink-0">مهندس إدارة مشاريع</span>
              <span className="text-blue-700 font-medium">{project.coordinator.full_name}</span>
            </span>
          )}
          {project.sales_engineer && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1 text-xs">
              <span className="font-bold text-emerald-500 text-[10px] shrink-0">مبيعات</span>
              <span className="text-emerald-700 font-medium">{project.sales_engineer.full_name}</span>
            </span>
          )}
          {project.installation_person && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-purple-50 border border-purple-100 px-2 py-1 text-xs">
              <span className="font-bold text-purple-500 text-[10px] shrink-0">تركيب</span>
              <span className="text-purple-700 font-medium">{project.installation_person.full_name}</span>
            </span>
          )}
          {!project.coordinator && !project.sales_engineer && !project.installation_person && (
            <span className="text-xs text-gray-400 italic">لم يُحدد الفريق بعد</span>
          )}
        </div>

        {/* Per-section completion */}
        {progress && (
          <div className="border-t border-gray-50 pt-3 mb-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-500">نسبة الإنجاز</span>
              <span className="text-[11px] font-bold text-brand-700">{progress.overall}%</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MiniMeter label="التحصيل" pct={progress.collection} />
              <MiniMeter label="المواد" pct={progress.materials} />
              {progress.installation !== null
                ? <MiniMeter label="التركيب" pct={progress.installation} />
                : <div className="text-center text-[10px] text-gray-300 self-center">بدون تركيب</div>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-gray-50 pt-3">
          <span className="flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:gap-2 transition-all duration-150">
            عرض التفاصيل
            <ChevronLeft className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}
