'use client'

import { useState, useTransition, useRef } from 'react'
import { toast } from 'sonner'
import { Plus, CreditCard, Receipt, Upload, X, FileText, ImageIcon, Trash2, Edit2, Paperclip, ExternalLink, Copy, Check, Send, CircleCheck, Circle, Printer, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { PaymentStatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { createPayment, recordPayment, deletePayment, editPayment, setSalesConfirmation } from '@/lib/actions/payments'
import { savePaymentAttachment, deleteAttachment, deletePaymentReceipt } from '@/lib/actions/attachments'
import { cn } from '@/lib/utils'
import { uploadFileDirect } from '@/lib/upload-client'
import {
  BILLING_STATES, BILLING_LABELS, BILLING_CHIP, BILLING_CHIP_ACTIVE,
  matchesBilling, type BillingState,
} from '@/lib/billing'
import { LETTERHEAD_CSS, letterheadOpenHtml, letterheadCloseHtml } from '@/lib/print-letterhead'
import { formatCurrency, formatDateShort, isOverdue } from '@/lib/utils'
import { PAYMENT_TYPE_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/constants'
import type { Payment, Profile, Document } from '@/types/database'

const PAYMENT_TYPES = ['upfront', 'materials', 'installation', 'final', 'custom'] as const

function paymentLabel(p: Payment) {
  return p.type === 'custom' ? (p.name || 'دفعة أخرى') : PAYMENT_TYPE_LABELS[p.type]
}

// invoice_date is a free-text column and holds mixed formats from older records
// (25.01.2026 / 2026.02.01 / 2026-07-08). Normalise to what <input type="date">
// needs, so switching to a calendar doesn't blank out — and then wipe — a value.
function toDateInputValue(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const pad = (n: string) => n.padStart(2, '0')
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/)   // DD.MM.YYYY
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/)       // YYYY.MM.DD
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  return ''
}


// LC maturity = pay date + tenor (days)
function lcMaturity(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

interface PaymentsTabProps {
  payments: Payment[]
  projectId: string
  canManage: boolean
  currentProfile?: Profile
  projectTotal?: number | null
  attachments?: Document[]
  canConfirmSales?: boolean
  hasInstallation?: boolean
  canPrintInvoice?: boolean
  projectName?: string
  clientName?: string
}

export function PaymentsTab({ payments, projectId, canManage, projectTotal, attachments = [], canConfirmSales = false, hasInstallation = true, canPrintInvoice = false, projectName, clientName }: PaymentsTabProps) {
  // Invoicing/collection filter — null shows every payment
  const [billingFilter, setBillingFilter] = useState<BillingState | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addType, setAddType] = useState('')
  const [addLc, setAddLc] = useState(false)
  const [editLc, setEditLc] = useState(false)
  const [inv, setInv] = useState({ invoice_number: '', invoice_date: '', seller_name: '', customer_account: '' })
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [recordPaymentId, setRecordPaymentId] = useState<string | null>(null)
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null)
  const [attachmentsPaymentId, setAttachmentsPaymentId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [recordAmount, setRecordAmount] = useState('')   // live, to warn on overpayment
  const [invoicePaymentId, setInvoicePaymentId] = useState<string | null>(null)   // language-choice dialog
  const [primaryFile, setPrimaryFile] = useState<File | null>(null)   // المرفق الأساسي للدفعة
  const [otherFiles, setOtherFiles] = useState<File[]>([])            // مرفقات أخرى
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const primaryInputRef = useRef<HTMLInputElement>(null)
  const otherInputRef = useRef<HTMLInputElement>(null)

  const selectedPayment = payments.find((p) => p.id === recordPaymentId)
  const editingPayment = payments.find((p) => p.id === editPaymentId)
  const attachmentsPayment = payments.find((p) => p.id === attachmentsPaymentId)

  const usedTypes = new Set(
    payments.filter((p) => p.status !== 'cancelled' && p.type !== 'custom').map((p) => p.type)
  )

  function attachmentsFor(paymentId: string) {
    return attachments.filter((a) => a.payment_id === paymentId)
  }

  function openAddDialog() {
    setAddType('')
    setAddLc(false)
    setInv({ invoice_number: '', invoice_date: '', seller_name: '', customer_account: '' })
    setPrimaryFile(null)
    setOtherFiles([])
    setShowAddDialog(true)
  }

  function closeAddDialog() {
    setShowAddDialog(false)
    setAddType('')
    setInv({ invoice_number: '', invoice_date: '', seller_name: '', customer_account: '' })
  }

  function handleAddPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    // Multiple payments of the same type are allowed (e.g. two materials
    // payments). Use the optional secondary title to tell them apart.
    const type = formData.get('type') as string
    formData.set('project_id', projectId)
    startTransition(async () => {
      try {
        const result = await createPayment(formData)
        if (result?.error) { toast.error(result.error); return }
        // Upload attachments staged during creation → link to the new payment
        const newId = result?.paymentId
        if (newId && (primaryFile || otherFiles.length > 0)) {
          const typeLabel = type === 'custom'
            ? ((formData.get('name') as string)?.trim() || 'الدفعة')
            : (PAYMENT_TYPE_LABELS[type as keyof typeof PAYMENT_TYPE_LABELS] ?? 'الدفعة')
          let ok = 0
          const jobs: { file: File; desc: string }[] = []
          if (primaryFile) jobs.push({ file: primaryFile, desc: `مرفق ${typeLabel}` })
          for (const f of otherFiles) jobs.push({ file: f, desc: f.name })
          for (const job of jobs) {
            const up = await uploadFileDirect(job.file, 'receipts')
            if ('error' in up) { toast.error(up.error); continue }
            const res = await savePaymentAttachment(projectId, newId, 'receipt', up.url, job.desc)
            if ('error' in res) toast.error(res.error)
            else ok++
          }
          toast.success(ok > 0 ? `تم إضافة الدفعة و ${ok} مرفق` : 'تم إضافة الدفعة')
        } else {
          toast.success('تم إضافة الدفعة بنجاح')
        }
        closeAddDialog()
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  function handleSalesToggle(paymentId: string, field: 'sales_invoice_sent' | 'sales_payment_confirmed', value: boolean) {
    startTransition(async () => {
      try {
        const res = await setSalesConfirmation(paymentId, projectId, field, value)
        if (res?.error) toast.error(res.error)
        else toast.success('تم تحديث التأكيد')
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  async function copyInvoiceNumber(id: string, num: string) {
    try {
      await navigator.clipboard.writeText(num)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch { toast.error('تعذّر النسخ') }
  }

  function handleRecordPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget

    // Overpayment: accepted, but only knowingly — with a note and a confirm.
    const p = payments.find((x) => x.id === recordPaymentId)
    if (p) {
      const entered = parseFloat((form.elements.namedItem('paid_amount') as HTMLInputElement)?.value || '0')
      const remaining = p.amount - p.paid_amount
      if (entered > remaining) {
        const note = (form.elements.namedItem('overpay_note') as HTMLInputElement)?.value?.trim()
        if (!note) { toast.error('المبلغ أكبر من المتبقي — اكتب ملاحظة توضّح سبب الزيادة أولاً'); return }
        const newTotal = p.paid_amount + entered
        const ok = confirm(
          `تنبيه: المبلغ المُدخل (${formatCurrency(entered)}) أكبر من المتبقي (${formatCurrency(remaining)}).\n\n` +
          `بالتأكيد سترتفع قيمة الدفعة المتفق عليها من ${formatCurrency(p.amount)} إلى ${formatCurrency(newTotal)}، ` +
          `وسيؤثر ذلك على إجمالي قيمة المشروع ونسب التحصيل.\n\nهل تريد المتابعة؟`
        )
        if (!ok) return
      }
    }

    startTransition(async () => {
      try {
        let receiptUrl = (form.elements.namedItem('receipt_url') as HTMLInputElement)?.value || ''
        if (receiptFile) {
          const uploadResult = await uploadFileDirect(receiptFile, 'receipts')
          if ('error' in uploadResult) { toast.error(uploadResult.error); return }
          receiptUrl = uploadResult.url
        }
        const formData = new FormData(form)
        formData.set('payment_id', recordPaymentId!)
        formData.set('project_id', projectId)
        formData.set('receipt_url', receiptUrl)
        const result = await recordPayment(formData)
        if (result?.error) toast.error(result.error)
        else { toast.success('تم تسجيل الدفعة بنجاح'); setRecordPaymentId(null); setReceiptFile(null); setRecordAmount('') }
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  function handleEditPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('payment_id', editPaymentId!)
    formData.set('project_id', projectId)
    startTransition(async () => {
      try {
        const result = await editPayment(formData)
        if (result?.error) toast.error(result.error)
        else { toast.success('تم تعديل الدفعة'); setEditPaymentId(null) }
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  function handleDeletePayment(payment: Payment) {
    const warningText = payment.status === 'paid'
      ? `تحذير: هذه الدفعة مؤكدة ومدفوعة بالكامل. هل أنت متأكد من حذف دفعة "${paymentLabel(payment)}"؟`
      : `هل تريد حذف دفعة "${paymentLabel(payment)}"؟`
    if (!confirm(warningText)) return
    startTransition(async () => {
      try {
        const result = await deletePayment(payment.id, projectId)
        if (result?.error) toast.error(result.error)
        else toast.success('تم حذف الدفعة')
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  function handleAttachmentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0 || !attachmentsPaymentId) return
    setUploadingAttachment(true)
    startTransition(async () => {
      try {
        let ok = 0
        let lastError = ''
        for (const file of files) {
          const up = await uploadFileDirect(file, 'receipts')
          if ('error' in up) { lastError = up.error; continue }
          const res = await savePaymentAttachment(projectId, attachmentsPaymentId, 'receipt', up.url, file.name)
          if ('error' in res) lastError = res.error
          else ok++
        }
        if (ok > 0) toast.success(ok === 1 ? 'تم رفع المرفق' : `تم رفع ${ok} مرفقات`)
        if (lastError) toast.error(lastError)
      } catch { toast.error('حدث خطأ غير متوقع') }
      finally { setUploadingAttachment(false) }
    })
  }

  function handleDeleteAttachment(docId: string) {
    if (!confirm('حذف هذا المرفق؟')) return
    startTransition(async () => {
      try {
        const res = await deleteAttachment(docId, projectId)
        if (res?.error) toast.error(res.error)
        else toast.success('تم حذف المرفق')
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  function handleDeleteReceipt(paymentId: string) {
    if (!confirm('حذف الإيصال الأساسي؟')) return
    startTransition(async () => {
      try {
        const res = await deletePaymentReceipt(paymentId, projectId)
        if (res?.error) toast.error(res.error)
        else toast.success('تم حذف الإيصال')
      } catch { toast.error('حدث خطأ غير متوقع') }
    })
  }

  function handleRecordClose() { setRecordPaymentId(null); setReceiptFile(null); setRecordAmount('') }

  // Bilingual invoice for a fully-paid payment — printed on the official
  // letterhead. Labels translate; entered data stays as typed.
  function printInvoice(p: Payment, lang: 'ar' | 'en') {
    const en = lang === 'en'
    const TYPE_EN: Record<string, string> = {
      upfront: 'Upfront Payment', materials: 'Materials Payment', installation: 'Installation Payment', final: 'Final Payment', custom: 'Payment',
    }
    const typeLabel = en
      ? (p.type === 'custom' ? (p.name || 'Payment') : TYPE_EN[p.type])
      : paymentLabel(p)
    const sub = p.type !== 'custom' && p.name ? p.name : ''
    const L = en
      ? { title: 'INVOICE', paid: 'PAID IN FULL', invNo: 'Invoice No.', invDate: 'Invoice Date', project: 'Project',
          client: 'Client', seller: 'Seller', account: 'Customer Account No.', payType: 'Payment', amount: 'Amount',
          paidAmount: 'Amount Paid', paidAt: 'Payment Date', billing: 'Billing Status', notes: 'Notes',
          issued: 'Issued on', sig1: 'Authorized Signature', sig2: 'Received by',
          billingMap: { collected: 'Collected', invoiced: 'Invoiced', both: 'Collected & Invoiced' } as Record<string, string> }
      : { title: 'فاتورة', paid: 'مدفوعة بالكامل', invNo: 'رقم الفاتورة', invDate: 'تاريخ الفاتورة', project: 'المشروع',
          client: 'العميل', seller: 'البائع', account: 'رقم حساب العميل', payType: 'الدفعة', amount: 'المبلغ',
          paidAmount: 'المبلغ المسدد', paidAt: 'تاريخ السداد', billing: 'حالة الفوترة', notes: 'ملاحظات',
          issued: 'تاريخ الإصدار', sig1: 'التوقيع المعتمد', sig2: 'المستلم',
          billingMap: BILLING_LABELS }
    const today = new Intl.DateTimeFormat(en ? 'en-GB' : 'ar-SA', {
      day: 'numeric', month: 'long', year: 'numeric', numberingSystem: 'latn', timeZone: 'Asia/Riyadh',
    }).format(new Date())
    const esc = (s: string) => s.replace(/</g, '&lt;')
    const row = (label: string, value: string | null | undefined) =>
      value ? `<tr><td class="lbl">${label}</td><td dir="auto">${esc(value)}</td></tr>` : ''

    const html = `<!DOCTYPE html><html dir="${en ? 'ltr' : 'rtl'}" lang="${lang}"><head><meta charset="utf-8">
      <title>${L.title} — ${projectName ?? ''}</title>
      <style>
        ${LETTERHEAD_CSS}
        body{font-family:${en ? 'Arial,sans-serif' : 'Tahoma,Arial,sans-serif'};color:#111}
        h2{color:#1841A0;margin:0;text-align:center;letter-spacing:${en ? '3px' : '0'};font-size:24px}
        .paidband{margin:10px auto 18px;width:max-content;background:#d1fae5;color:#047857;border:1px solid #a7f3d0;
          border-radius:99px;padding:5px 18px;font-weight:800;font-size:13px}
        table.inv{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
        table.inv td{border:1px solid #e2e8f0;padding:9px 12px}
        table.inv td.lbl{background:#f1f5f9;font-weight:700;color:#334155;width:34%}
        .totals{margin-top:16px;display:flex;justify-content:${en ? 'flex-end' : 'flex-start'}}
        .totalbox{background:#1841A0;color:#fff;border-radius:12px;padding:12px 26px;text-align:center}
        .totalbox .v{font-size:20px;font-weight:800;direction:ltr}
        .totalbox .t{font-size:11px;opacity:.85;margin-top:2px}
        .sign{display:flex;justify-content:space-between;margin-top:56px;gap:40px}
        .sign div{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px;color:#333;text-align:center}
        .meta{color:#64748b;font-size:11px;text-align:center;margin-top:6px}
      </style></head><body>
      ${letterheadOpenHtml(window.location.origin)}
      <h2>${L.title}</h2>
      <div class="paidband">✓ ${L.paid}</div>
      <table class="inv">
        ${row(L.invNo, p.invoice_number)}
        ${row(L.invDate, toDateInputValue(p.invoice_date) || p.invoice_date)}
        ${row(L.project, projectName)}
        ${row(L.client, clientName)}
        ${row(L.seller, p.seller_name)}
        ${row(L.account, p.customer_account)}
        ${row(L.payType, sub ? `${typeLabel} — ${sub}` : typeLabel)}
        ${row(L.paidAt, p.paid_at ? formatDateShort(p.paid_at) : null)}
        ${row(L.billing, p.billing_status ? (L.billingMap[p.billing_status] ?? p.billing_status) : null)}
        ${row(L.notes, p.notes)}
      </table>
      <div class="totals">
        <div class="totalbox"><div class="v">${formatCurrency(p.paid_amount)}</div><div class="t">${L.paidAmount}</div></div>
      </div>
      <div class="sign"><div>${L.sig1}</div><div>${L.sig2}</div></div>
      <p class="meta">${L.issued}: ${today}</p>
      ${letterheadCloseHtml()}
      </body></html>`

    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 300)
    setInvoicePaymentId(null)
  }

  const shownPayments = billingFilter
    ? payments.filter((p) => matchesBilling(p.billing_status, billingFilter))
    : payments
  const activePayments = payments.filter((p) => p.status !== 'cancelled')
  const totalAmount = activePayments.reduce((s, p) => s + (p.amount ?? 0), 0)
  const totalPaid = activePayments.reduce((s, p) => s + (p.paid_amount ?? 0), 0)
  // Collection % = how much of the PROJECT VALUE has been collected
  const baseValue = projectTotal != null && projectTotal > 0 ? projectTotal : totalAmount
  const remaining = Math.max(0, baseValue - totalPaid)
  const collectionPct = baseValue > 0 ? Math.round((totalPaid / baseValue) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100">
            <CreditCard className="h-4 w-4 text-blue-700" />
          </div>
          <h3 className="text-base font-semibold text-gray-900">جدول الدفعات</h3>
          {payments.length > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">{payments.length}</span>
          )}
        </div>
        {canManage && (
          <Button size="sm" onClick={openAddDialog}>
            <Plus className="h-4 w-4" />
            إضافة دفعة
          </Button>
        )}
      </div>

      {/* Summary */}
      {payments.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <SummaryFigure label="قيمة المشروع" value={formatCurrency(baseValue)} tone="text-gray-900" />
            <SummaryFigure label="إجمالي المدفوع" value={formatCurrency(totalPaid)} tone="text-emerald-600" />
            <SummaryFigure label="المتبقي" value={formatCurrency(remaining)} tone={remaining > 0 ? 'text-amber-600' : 'text-emerald-600'} highlight />
          </div>
          {baseValue > 0 && (
            <>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div className={`h-full rounded-full transition-all duration-500 ${collectionPct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(100, collectionPct)}%` }} />
              </div>
              <p className="text-xs text-gray-400 mt-1.5">{collectionPct}% مُحصَّل من قيمة المشروع</p>
            </>
          )}
        </div>
      )}

      {/* ── Invoicing / collection filter ──
          Always visible, and every state is always listed even at zero, so the
          filter is a stable part of the screen rather than something that
          appears and disappears depending on the data. */}
      {payments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500">حالة الفوترة والتحصيل:</span>
          <button onClick={() => setBillingFilter(null)}
            className={cn('rounded-full border px-3 py-1 text-xs font-semibold transition-all',
              billingFilter === null ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300')}>
            الكل <span className="opacity-70">{payments.length}</span>
          </button>
          {BILLING_STATES.map((state) => {
            const count = payments.filter((p) => matchesBilling(p.billing_status, state)).length
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
      )}

      {payments.length === 0 ? (
        <EmptyState message="لا توجد دفعات مضافة" description="أضف جدول الدفعات للمشروع" icon={<CreditCard className="h-8 w-8 text-gray-400" />} />
      ) : shownPayments.length === 0 ? (
        <EmptyState message="لا يوجد" description={`لا توجد دفعات بحالة «${BILLING_LABELS[billingFilter!] ?? ''}»`} icon={<CreditCard className="h-8 w-8 text-gray-400" />} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shownPayments.map((payment, idx) => {
            const overdue = isOverdue(payment.due_date, payment.status)
            const displayStatus = overdue && payment.status === 'pending' ? 'overdue' : payment.status
            const paidPct = payment.amount > 0 ? Math.min(100, Math.round((payment.paid_amount / payment.amount) * 100)) : 0
            // Edit is always available to managers — it's how a mistaken
            // cancel / partial / paid gets corrected (status is editable inside).
            const canEdit = canManage
            const canDelete = canManage && payment.status !== 'cancelled'
            const attachCount = attachmentsFor(payment.id).length + (payment.receipt_url ? 1 : 0)

            return (
              <div key={payment.id} className={`rounded-2xl border shadow-sm overflow-hidden ${
                overdue ? 'border-red-200 bg-red-50/20'
                : payment.status === 'paid' ? 'border-green-200 bg-green-50/10'
                : payment.status === 'cancelled' ? 'border-gray-200 bg-gray-50/50 opacity-60'
                : 'border-gray-100 bg-white'}`}>
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-100 px-1.5 text-[11px] font-bold text-gray-500">
                          {payment.order_no ?? idx + 1}
                        </span>
                        <p className="text-base font-extrabold text-gray-900 truncate">
                          {paymentLabel(payment)}
                        </p>
                      </div>
                      {/* Secondary title — a free note that shows under the type */}
                      {payment.type !== 'custom' && payment.name && (
                        <p className="text-xs font-medium text-brand-600 truncate mt-0.5">{payment.name}</p>
                      )}
                      <p className="text-2xl font-bold text-gray-900 mt-1 leading-tight">{formatCurrency(payment.amount)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <PaymentStatusBadge status={displayStatus} />
                      {canEdit && (
                        <button onClick={() => { setEditLc(!!payment.lc_enabled); setEditPaymentId(payment.id) }} className="rounded-lg p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="تعديل">
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDeletePayment(payment)} disabled={isPending} className="rounded-lg p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50" title="حذف">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {payment.due_date && (
                    <p className={`flex items-center gap-1.5 text-xs mb-3 ${overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      <Receipt className="h-3 w-3 shrink-0" />
                      استحقاق: <span className={`font-bold ${overdue ? 'text-red-600' : 'text-brand-800'}`} dir="ltr">{formatDateShort(payment.due_date)}</span>
                      {overdue && <span className="text-red-500">(متأخر)</span>}
                    </p>
                  )}

                  {payment.paid_amount > 0 && payment.status !== 'paid' && payment.status !== 'cancelled' && (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                        <span>محصّل: <strong className="text-gray-700">{formatCurrency(payment.paid_amount)}</strong></span>
                        <span className="font-semibold text-brand-600">{paidPct}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-brand-500 transition-all duration-500" style={{ width: `${paidPct}%` }} />
                      </div>
                      <p className="text-xs text-gray-400 mt-1">متبقي: {formatCurrency(payment.amount - payment.paid_amount)}</p>
                    </div>
                  )}

                  {payment.status === 'paid' && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium mb-2">
                      <Receipt className="h-3.5 w-3.5" />
                      مدفوع بالكامل — {formatCurrency(payment.amount)}
                    </div>
                  )}

                  {payment.billing_status && BILLING_LABELS[payment.billing_status] && (
                    <span className={`inline-block mb-2 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${BILLING_CHIP[payment.billing_status] ?? 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                      {BILLING_LABELS[payment.billing_status]}
                    </span>
                  )}

                  {payment.lc_enabled && (
                    <div className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-700">
                        <FileText className="h-3.5 w-3.5" /> خطاب اعتماد (LC)
                      </div>
                      <p className="text-[11px] text-indigo-600 mt-0.5">
                        تاريخ الدفع: {payment.lc_date ? <span className="font-bold text-brand-800" dir="ltr">{formatDateShort(payment.lc_date)}</span> : '—'}
                        {payment.lc_days != null && ` · المدة: ${payment.lc_days} يوم`}
                        {payment.lc_date && payment.lc_days != null && <> · الاستحقاق: <span className="font-bold text-brand-800" dir="ltr">{formatDateShort(lcMaturity(payment.lc_date, payment.lc_days))}</span></>}
                      </p>
                    </div>
                  )}

                  {payment.invoice_number && (
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">
                      <FileText className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                      <span className="text-xs text-gray-500">رقم الفاتورة:</span>
                      <span className="text-xs font-bold text-gray-800 truncate" dir="ltr">{payment.invoice_number}</span>
                      <button
                        onClick={() => copyInvoiceNumber(payment.id, payment.invoice_number!)}
                        className="ms-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-50 transition-colors shrink-0"
                        title="نسخ رقم الفاتورة (لـ SAP)"
                      >
                        {copiedId === payment.id ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                        {copiedId === payment.id ? 'تم' : 'نسخ'}
                      </button>
                    </div>
                  )}

                  {/* Sales engineer double-check */}
                  {(canConfirmSales || payment.sales_invoice_sent || payment.sales_payment_confirmed) && (
                    <div className="mb-2 space-y-1.5 rounded-lg bg-emerald-50/40 border border-emerald-100 p-2.5">
                      <p className="text-[11px] font-semibold text-emerald-700">تأكيد مهندس المبيعات</p>
                      <SalesCheck
                        icon={<Send className="h-3.5 w-3.5" />}
                        label="تم إرسال الفاتورة للعميل"
                        active={payment.sales_invoice_sent}
                        canToggle={canConfirmSales}
                        disabled={isPending}
                        onToggle={() => handleSalesToggle(payment.id, 'sales_invoice_sent', !payment.sales_invoice_sent)}
                      />
                      <SalesCheck
                        icon={<CircleCheck className="h-3.5 w-3.5" />}
                        label="العميل دفع المبلغ"
                        active={payment.sales_payment_confirmed}
                        canToggle={canConfirmSales}
                        disabled={isPending}
                        onToggle={() => handleSalesToggle(payment.id, 'sales_payment_confirmed', !payment.sales_payment_confirmed)}
                      />
                    </div>
                  )}

                  {payment.notes && <p className="text-xs text-gray-500 italic mb-2">{payment.notes}</p>}
                </div>

                {/* Footer */}
                <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setAttachmentsPaymentId(payment.id)}
                    className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 hover:underline font-medium"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    المرفقات
                    {attachCount > 0 && (
                      <span className="rounded-full bg-brand-100 px-1.5 text-[10px] font-bold text-brand-700">{attachCount}</span>
                    )}
                  </button>
                  {canManage && payment.status !== 'paid' && payment.status !== 'cancelled' && (
                    <Button size="sm" variant="outline" onClick={() => setRecordPaymentId(payment.id)}>تسجيل دفعة</Button>
                  )}
                  {/* Fully paid → printable invoice (admin / PM engineer / sales) */}
                  {canPrintInvoice && payment.status === 'paid' && (
                    <Button size="sm" variant="outline" onClick={() => setInvoicePaymentId(payment.id)}
                      className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
                      <Printer className="h-3.5 w-3.5" />
                      طباعة الفاتورة
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Add payment dialog ── */}
      <Dialog open={showAddDialog} onClose={closeAddDialog} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>إضافة دفعة جديدة</DialogTitle>
          <DialogClose onClose={closeAddDialog} />
        </DialogHeader>
        <DialogContent className="max-h-[60vh] overflow-y-auto">
          <form id="add-payment-form" onSubmit={handleAddPayment} className="space-y-4">
            <div className="space-y-1.5">
              <Label>نوع الدفعة</Label>
              <Select name="type" required placeholder="اختر النوع" value={addType} onChange={(e) => setAddType(e.target.value)}>
                {PAYMENT_TYPES.filter((t) => hasInstallation || t !== 'installation').map((type) => {
                  const existing = usedTypes.has(type)
                  const label = type === 'custom' ? 'أخرى' : PAYMENT_TYPE_LABELS[type]
                  return (
                    <option key={type} value={type}>
                      {label}{type !== 'custom' && existing ? ' — (يوجد دفعة مماثلة)' : ''}
                    </option>
                  )
                })}
              </Select>
            </div>

            {addType === 'custom' ? (
              <div className="space-y-1.5">
                <Label>اسم الدفعة</Label>
                <Input name="name" required placeholder="مثال: دفعة ضمان، دفعة إضافية..." />
              </div>
            ) : addType ? (
              <div className="space-y-1.5">
                <Label>عنوان ثانوي <span className="text-gray-400 font-normal">— اختياري، يظهر تحت اسم النوع</span></Label>
                <Input name="name" placeholder="مثال: الدفعة المقدمة 25%، دفعة تعاقد..." />
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>رقم الدفعة (الترتيب)</Label>
                <Input name="order_no" type="number" min="1" step="1" defaultValue={payments.length + 1} placeholder="1" />
              </div>
              <div className="space-y-1.5">
                <Label>النسبة (%)</Label>
                <Input name="percentage" type="number" min="0" max="100" step="0.1" placeholder="اختياري" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>المبلغ (ريال)</Label>
              <Input name="amount" type="number" min="0" step="0.01" required placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ الاستحقاق</Label>
              <Input name="due_date" type="date" dir="ltr" />
            </div>

            {/* Letter of Credit (LC) */}
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={addLc} onChange={(e) => setAddLc(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                <input type="hidden" name="lc_enabled" value={addLc ? 'true' : 'false'} />
                <span className="text-sm font-medium text-gray-700">يوجد خطاب اعتماد (LC)؟</span>
              </label>
              {addLc && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>تاريخ الدفع (LC)</Label>
                    <Input name="lc_date" type="date" dir="ltr" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>المدة (عدد الأيام)</Label>
                    <Input name="lc_days" type="number" min="0" step="1" dir="ltr" placeholder="مثال: 90" />
                  </div>
                  <p className="sm:col-span-2 text-[11px] text-gray-400">
                    يصل تنبيه لمهندس إدارة المشاريع عند حلول تاريخ استحقاق الخطاب (تاريخ الدفع + عدد الأيام).
                  </p>
                </div>
              )}
            </div>

            {/* Invoice fields (manual + OCR autofill) */}
            <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-500">بيانات الفاتورة الضريبية</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>رقم الفاتورة</Label>
                  <Input name="invoice_number" dir="ltr" placeholder="—" value={inv.invoice_number}
                    onChange={(e) => setInv((p) => ({ ...p, invoice_number: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ الفاتورة</Label>
                  <Input name="invoice_date" type="date" dir="ltr" value={inv.invoice_date}
                    onChange={(e) => setInv((p) => ({ ...p, invoice_date: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>اسم الشركة / البائع</Label>
                  <Input name="seller_name" placeholder="—" value={inv.seller_name}
                    onChange={(e) => setInv((p) => ({ ...p, seller_name: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>رقم حساب العميل</Label>
                  <Input name="customer_account" dir="ltr" placeholder="—" value={inv.customer_account}
                    onChange={(e) => setInv((p) => ({ ...p, customer_account: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Primary attachment — labelled by the payment type */}
            <div className="space-y-1.5">
              <Label>
                المرفق الأساسي
                <span className="text-gray-400 font-normal"> — {addType === 'custom' ? 'مرفق الدفعة' : `مرفق ${PAYMENT_TYPE_LABELS[addType as keyof typeof PAYMENT_TYPE_LABELS] ?? 'الدفعة'}`}</span>
              </Label>
              {primaryFile ? (
                <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
                  {primaryFile.type === 'application/pdf' ? <FileText className="h-4 w-4 text-brand-700 shrink-0" /> : <ImageIcon className="h-4 w-4 text-brand-700 shrink-0" />}
                  <span className="flex-1 text-sm text-gray-800 truncate">{primaryFile.name}</span>
                  <button type="button" onClick={() => setPrimaryFile(null)} className="text-gray-400 hover:text-red-500"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <button type="button" onClick={() => primaryInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-3 text-sm text-gray-500 hover:border-brand-300 hover:bg-brand-50/30 transition-colors">
                  <Upload className="h-4 w-4" /> رفع المرفق الأساسي
                </button>
              )}
              <input ref={primaryInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { setPrimaryFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
            </div>

            {/* Other attachments (multiple) */}
            <div className="space-y-1.5">
              <Label>مرفقات أخرى <span className="text-gray-400 font-normal">— اختياري (أكثر من ملف)</span></Label>
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-2">
                {otherFiles.length > 0 && (
                  <div className="space-y-1.5">
                    {otherFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-2.5 py-1.5">
                        {f.type === 'application/pdf' ? <FileText className="h-4 w-4 text-gray-400 shrink-0" /> : <ImageIcon className="h-4 w-4 text-gray-400 shrink-0" />}
                        <span className="flex-1 text-xs text-gray-700 truncate">{f.name}</span>
                        <button type="button" onClick={() => setOtherFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-300 hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => otherInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
                  <Upload className="h-4 w-4" /> إضافة ملفات
                  {otherFiles.length > 0 && <span className="rounded-full bg-brand-100 px-1.5 text-[10px] font-bold text-brand-700">{otherFiles.length}</span>}
                </button>
                <input ref={otherInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.csv" className="hidden"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? [])
                    e.target.value = ''
                    if (picked.length) {
                      setOtherFiles((prev) => [...prev, ...picked])
                      toast.success(`تمت إضافة ${picked.length} ملف للقائمة`)
                    }
                  }} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>ملاحظات</Label>
              <Input name="notes" placeholder="اختياري" />
            </div>
          </form>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={closeAddDialog}>إلغاء</Button>
          <Button type="submit" form="add-payment-form" loading={isPending}>إضافة</Button>
        </DialogFooter>
      </Dialog>

      {/* ── Edit payment dialog — everything is editable ── */}
      <Dialog open={!!editPaymentId} onClose={() => setEditPaymentId(null)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>تعديل الدفعة — {editingPayment && paymentLabel(editingPayment)}</DialogTitle>
          <DialogClose onClose={() => setEditPaymentId(null)} />
        </DialogHeader>
        <DialogContent className="max-h-[65vh] overflow-y-auto">
          {editingPayment && (
            <form id="edit-payment-form" onSubmit={handleEditPayment} className="space-y-4">
              {/* Type + secondary title */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>نوع الدفعة</Label>
                  <Select name="type" defaultValue={editingPayment.type}>
                    {PAYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t === 'custom' ? 'أخرى' : PAYMENT_TYPE_LABELS[t]}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>العنوان الثانوي <span className="text-gray-400 font-normal">— يظهر تحت النوع</span></Label>
                  <Input name="name" defaultValue={editingPayment.name ?? ''} placeholder="اختياري" />
                </div>
              </div>

              {/* Amount + collected + status */}
              <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3 space-y-3">
                <p className="text-xs font-semibold text-amber-700">المبلغ والحالة — لتصحيح أي خطأ</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>المبلغ (ريال)</Label>
                    <Input name="amount" type="number" min="0.01" step="0.01" required defaultValue={editingPayment.amount} placeholder="0.00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>المحصّل (ريال)</Label>
                    <Input name="paid_amount" type="number" min="0" step="0.01" defaultValue={editingPayment.paid_amount} placeholder="0.00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>الحالة</Label>
                    <Select name="status" defaultValue={editingPayment.status}>
                      {(['pending', 'partial', 'paid', 'overdue', 'cancelled'] as const).map((s) => (
                        <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>
                      ))}
                    </Select>
                  </div>
                </div>
                <p className="text-[11px] text-amber-600">
                  اختيار «مدفوعة» يجعل المحصّل = كامل المبلغ، و«معلّقة» يصفّره. لتحصيل جزئي اختر «مدفوعة جزئياً» واكتب المبلغ المحصّل.
                </p>
              </div>

              {/* Order + percentage + due date */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>رقم الدفعة (الترتيب)</Label>
                  <Input name="order_no" type="number" min="1" step="1"
                    defaultValue={editingPayment.order_no ?? (payments.findIndex((p) => p.id === editingPayment.id) + 1)} />
                </div>
                <div className="space-y-1.5">
                  <Label>النسبة (%)</Label>
                  <Input name="percentage" type="number" min="0" max="100" step="0.1" defaultValue={editingPayment.percentage ?? ''} placeholder="اختياري" />
                </div>
                <div className="space-y-1.5">
                  <Label>تاريخ الاستحقاق</Label>
                  <Input name="due_date" type="date" dir="ltr" defaultValue={editingPayment.due_date ?? ''} />
                </div>
              </div>

              {/* Letter of Credit (LC) */}
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editLc} onChange={(e) => setEditLc(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                  <input type="hidden" name="lc_enabled" value={editLc ? 'true' : 'false'} />
                  <span className="text-sm font-medium text-gray-700">يوجد خطاب اعتماد (LC)؟</span>
                </label>
                {editLc && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>تاريخ الدفع (LC)</Label>
                      <Input name="lc_date" type="date" dir="ltr" defaultValue={editingPayment.lc_date ?? ''} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>المدة (عدد الأيام)</Label>
                      <Input name="lc_days" type="number" min="0" step="1" dir="ltr" defaultValue={editingPayment.lc_days ?? ''} placeholder="مثال: 90" />
                    </div>
                    <p className="sm:col-span-2 text-[11px] text-gray-400">
                      يصل تنبيه لمهندس إدارة المشاريع عند حلول تاريخ استحقاق الخطاب (تاريخ الدفع + عدد الأيام).
                    </p>
                  </div>
                )}
              </div>

              {/* Invoice fields */}
              <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-500">بيانات الفاتورة الضريبية</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>رقم الفاتورة</Label>
                    <Input name="invoice_number" dir="ltr" defaultValue={editingPayment.invoice_number ?? ''} placeholder="—" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>تاريخ الفاتورة</Label>
                    <Input name="invoice_date" type="date" dir="ltr" defaultValue={toDateInputValue(editingPayment.invoice_date)} />
                    {editingPayment.invoice_date && !toDateInputValue(editingPayment.invoice_date) && (
                      <p className="text-[11px] text-amber-600">
                        القيمة المحفوظة «{editingPayment.invoice_date}» بصيغة غير مفهومة — اختر التاريخ من التقويم لتصحيحها.
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label>اسم الشركة / البائع</Label>
                    <Input name="seller_name" defaultValue={editingPayment.seller_name ?? ''} placeholder="—" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>رقم حساب العميل</Label>
                    <Input name="customer_account" dir="ltr" defaultValue={editingPayment.customer_account ?? ''} placeholder="—" />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>حالة الفوترة والتحصيل</Label>
                  <Select name="billing_status" defaultValue={editingPayment.billing_status ?? ''}>
                    <option value="">— بدون —</option>
                    <option value="collected">تم التحصيل</option>
                    <option value="invoiced">تم الفوترة</option>
                    <option value="both">تم التحصيل والفوترة</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>ملاحظات</Label>
                  <Input name="notes" defaultValue={editingPayment.notes ?? ''} placeholder="اختياري" />
                </div>
              </div>
            </form>
          )}
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditPaymentId(null)}>إلغاء</Button>
          <Button type="submit" form="edit-payment-form" loading={isPending}>
            <Edit2 className="h-4 w-4" />
            حفظ التعديلات
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Record payment dialog ── */}
      <Dialog open={!!recordPaymentId} onClose={handleRecordClose}>
        <DialogHeader>
          <DialogTitle>تسجيل دفعة — {selectedPayment && paymentLabel(selectedPayment)}</DialogTitle>
          <DialogClose onClose={handleRecordClose} />
        </DialogHeader>
        <DialogContent>
          {selectedPayment && (
            <form id="record-payment-form" onSubmit={handleRecordPayment} className="space-y-4">
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 text-sm space-y-1">
                <p className="text-gray-600">إجمالي الدفعة: <span className="font-bold text-gray-900">{formatCurrency(selectedPayment.amount)}</span></p>
                <p className="text-gray-600">المحصّل: <span className="font-bold text-gray-900">{formatCurrency(selectedPayment.paid_amount)}</span></p>
                <p className="text-gray-600">المتبقي: <span className="font-bold text-red-600">{formatCurrency(selectedPayment.amount - selectedPayment.paid_amount)}</span></p>
              </div>
              <div className="space-y-1.5">
                <Label>المبلغ المحصّل الآن (ريال)</Label>
                <Input name="paid_amount" type="number" min="0.01" step="0.01" required placeholder="0.00"
                  value={recordAmount} onChange={(e) => setRecordAmount(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>حالة الفوترة والتحصيل</Label>
                <Select name="billing_status" defaultValue={selectedPayment.billing_status ?? ''}>
                  <option value="">— اختر —</option>
                  <option value="collected">تم التحصيل</option>
                  <option value="invoiced">تم الفوترة</option>
                  <option value="both">تم التحصيل والفوترة</option>
                </Select>
              </div>

              {/* Overpayment: allowed, but knowingly — warn + require a note */}
              {(() => {
                const entered = parseFloat(recordAmount || '0')
                const remaining = selectedPayment.amount - selectedPayment.paid_amount
                if (!(entered > remaining)) return null
                const newTotal = selectedPayment.paid_amount + entered
                return (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2.5">
                    <p className="text-sm font-bold text-amber-800">
                      ⚠️ المبلغ أكبر من المتبقي ({formatCurrency(remaining)})
                    </p>
                    <p className="text-xs text-amber-700 leading-relaxed">
                      عند التأكيد سترتفع قيمة الدفعة المتفق عليها من <strong>{formatCurrency(selectedPayment.amount)}</strong> إلى{' '}
                      <strong>{formatCurrency(newTotal)}</strong> — وسيؤثر ذلك على إجمالي قيمة المشروع ونسب التحصيل.
                    </p>
                    <div className="space-y-1.5">
                      <Label className="text-amber-800">ملاحظة توضّح سبب الزيادة *</Label>
                      <Input name="overpay_note" required placeholder="مثال: العميل سدّد بنداً إضافياً متفقاً عليه هاتفياً..." className="bg-white" />
                    </div>
                  </div>
                )
              })()}
              <div className="space-y-1.5">
                <Label>إيصال الدفع (صورة أو PDF)</Label>
                <input type="hidden" name="receipt_url" />
                {receiptFile ? (
                  <div className="flex items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100">
                      {receiptFile.type === 'application/pdf' ? <FileText className="h-5 w-5 text-brand-700" /> : <ImageIcon className="h-5 w-5 text-brand-700" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{receiptFile.name}</p>
                      <p className="text-xs text-gray-500">{(receiptFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button type="button" onClick={() => { setReceiptFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }} className="rounded-lg p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-6 text-center hover:border-brand-300 hover:bg-brand-50/30 transition-colors">
                    <Upload className="h-6 w-6 text-gray-400" />
                    <p className="text-sm font-medium text-gray-600">اضغط لرفع الإيصال</p>
                    <p className="text-xs text-gray-400">JPG، PNG، PDF، Excel — حتى 50 ميجابايت</p>
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.csv" className="hidden" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
                <p className="text-xs text-gray-400">يمكنك إضافة مرفقات أخرى (فاتورة، ضمان...) من زر «المرفقات» بعد التسجيل.</p>
              </div>
            </form>
          )}
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onClick={handleRecordClose}>إلغاء</Button>
          <Button type="submit" form="record-payment-form" loading={isPending} variant="success">
            {isPending ? 'جاري الرفع...' : 'تأكيد الاستلام'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ── Invoice language dialog ── */}
      <Dialog open={!!invoicePaymentId} onClose={() => setInvoicePaymentId(null)} className="max-w-sm">
        <DialogHeader>
          <DialogTitle>طباعة الفاتورة</DialogTitle>
          <DialogClose onClose={() => setInvoicePaymentId(null)} />
        </DialogHeader>
        <DialogContent>
          <p className="mb-4 text-sm text-gray-500">اختر لغة الفاتورة — ستُطبع على الورق الرسمي بشعار سمنان.</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { const p = payments.find((x) => x.id === invoicePaymentId); if (p) printInvoice(p, 'ar') }}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-gray-200 bg-white p-5 transition-all duration-200 hover:border-brand-400 hover:bg-brand-50/40 hover:-translate-y-0.5 hover:shadow"
            >
              <Globe className="h-6 w-6 text-brand-600" />
              <span className="text-sm font-bold text-gray-800">عربي</span>
            </button>
            <button
              onClick={() => { const p = payments.find((x) => x.id === invoicePaymentId); if (p) printInvoice(p, 'en') }}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-gray-200 bg-white p-5 transition-all duration-200 hover:border-brand-400 hover:bg-brand-50/40 hover:-translate-y-0.5 hover:shadow"
            >
              <Globe className="h-6 w-6 text-brand-600" />
              <span className="text-sm font-bold text-gray-800">English</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Attachments dialog ── */}
      <Dialog open={!!attachmentsPaymentId} onClose={() => setAttachmentsPaymentId(null)}>
        <DialogHeader>
          <DialogTitle>مرفقات الدفعة — {attachmentsPayment && paymentLabel(attachmentsPayment)}</DialogTitle>
          <DialogClose onClose={() => setAttachmentsPaymentId(null)} />
        </DialogHeader>
        <DialogContent>
          {attachmentsPayment && (
            <div className="space-y-3">
              {/* Primary receipt (from record payment) */}
              {attachmentsPayment.receipt_url && (
                <AttachmentRow
                  label="إيصال الدفع الأساسي"
                  url={attachmentsPayment.receipt_url}
                  canManage={canManage}
                  onDelete={() => handleDeleteReceipt(attachmentsPayment.id)}
                />
              )}

              {/* Extra attachments */}
              {attachmentsFor(attachmentsPayment.id).map((doc) => (
                <AttachmentRow
                  key={doc.id}
                  label={doc.description || 'مرفق'}
                  url={doc.url}
                  canManage={canManage}
                  onDelete={() => handleDeleteAttachment(doc.id)}
                />
              ))}

              {!attachmentsPayment.receipt_url && attachmentsFor(attachmentsPayment.id).length === 0 && (
                <p className="text-center text-sm text-gray-400 py-4">لا توجد مرفقات لهذه الدفعة</p>
              )}

              {canManage && (
                <>
                  <button type="button" onClick={() => attachInputRef.current?.click()} disabled={uploadingAttachment}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 py-4 text-sm text-gray-500 hover:border-brand-300 hover:bg-brand-50/30 transition-colors disabled:opacity-60">
                    {uploadingAttachment ? <Upload className="h-4 w-4 animate-pulse" /> : <Paperclip className="h-4 w-4" />}
                    {uploadingAttachment ? 'جاري الرفع...' : 'إضافة مرفقات (إيصال، فاتورة، ضمان...)'}
                  </button>
                  <input ref={attachInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.xlsx,.xls,.csv" className="hidden" onChange={handleAttachmentUpload} />
                  <p className="text-xs text-gray-400 text-center">يمكنك رفع أكثر من ملف — بدون اسم إلزامي</p>
                </>
              )}
            </div>
          )}
        </DialogContent>
        <DialogFooter>
          <Button onClick={() => setAttachmentsPaymentId(null)}>تم</Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}

function SalesCheck({ icon, label, active, canToggle, disabled, onToggle }: {
  icon: React.ReactNode
  label: string
  active: boolean
  canToggle: boolean
  disabled: boolean
  onToggle: () => void
}) {
  if (!canToggle) {
    // Read-only view (coordinator/admin) — only show when confirmed
    if (!active) return null
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-700">
        <CircleCheck className="h-3.5 w-3.5 shrink-0" />
        <span>{label} ✓</span>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors disabled:opacity-50 ${active ? 'text-emerald-700' : 'text-gray-500 hover:bg-emerald-50'}`}
    >
      <span className={active ? 'text-emerald-600' : 'text-gray-300'}>
        {active ? <CircleCheck className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
      </span>
      <span className="text-gray-400">{icon}</span>
      <span className={active ? 'font-medium' : ''}>{label}</span>
    </button>
  )
}

function SummaryFigure({ label, value, tone, highlight }: { label: string; value: string; tone: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-2.5 text-center ${highlight ? 'border-amber-100 bg-amber-50/50' : 'border-gray-100 bg-gray-50/50'}`}>
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
    </div>
  )
}

function AttachmentRow({ label, url, canManage, onDelete }: { label: string; url: string; canManage: boolean; onDelete: () => void }) {
  const isPdf = url.toLowerCase().includes('.pdf')
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 shrink-0">
        {isPdf ? <FileText className="h-4 w-4 text-gray-500" /> : <ImageIcon className="h-4 w-4 text-gray-500" />}
      </div>
      <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{label}</span>
      <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 shrink-0">
        <ExternalLink className="h-3.5 w-3.5" /> عرض
      </a>
      {canManage && (
        <button onClick={onDelete} className="rounded-lg p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0" title="حذف">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
