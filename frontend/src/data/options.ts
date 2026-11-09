import type { ResponseOption } from './types'

export const options: ResponseOption[] = [
  // Wheat, AL-W-001
  { id: 'O-W-1', alertId: 'AL-W-001', type: 'sourcing', name: 'Alternative Supplier V', qualification: 'qualified', specFit: 'meets', capacity: '150 t / month (stated, not verified)', unitPrice: 230, leadTimeDays: 10, quoteValidUntil: '2026-12-15', note: 'Qualified milling grade. Commercial terms not agreed.' },
  { id: 'O-W-2', alertId: 'AL-W-001', type: 'sourcing', name: 'Alternative Supplier U', qualification: 'unknown', specFit: 'unknown', capacity: '80 t / month (stated, not verified)', unitPrice: 224, leadTimeDays: 7, quoteValidUntil: '2026-12-01', note: 'Qualification not on file. Unknown qualification is not approved.' },
  { id: 'O-W-3', alertId: 'AL-W-001', type: 'inventory', name: 'Transfer stock from Plant Z2', qualification: 'qualified', specFit: 'meets', capacity: '40 t available', quantityAvailable: 40, leadTimeDays: 1, note: 'Internal transfer. Handling cost not included.' },
  { id: 'O-W-4', alertId: 'AL-W-001', type: 'logistics', name: 'Expedited freight on current route', qualification: 'qualified', specFit: 'meets', capacity: 'Route-limited', unitPrice: 212, leadTimeDays: 8, quoteValidUntil: '2026-11-01', note: 'Quote has expired. Needs a fresh quote.' },
  // Tungsten, AL-T-001
  { id: 'O-T-1', alertId: 'AL-T-001', type: 'sourcing', name: 'Alternative APT supplier, Country V', qualification: 'qualified', specFit: 'meets', capacity: '6 t / quarter (stated, not verified)', unitPrice: 46000, leadTimeDays: 60, quoteValidUntil: '2026-12-31', note: 'Qualified for carbide-grade powder.' },
  { id: 'O-T-2', alertId: 'AL-T-001', type: 'sourcing', name: 'Recycled tungsten scrap blend', qualification: 'unknown', specFit: 'partial', capacity: '3 t / quarter (stated, not verified)', unitPrice: 41000, leadTimeDays: 45, quoteValidUntil: '2027-01-31', note: 'Specification only partly meets requirement; qualification pending.' },
  { id: 'O-T-3', alertId: 'AL-T-001', type: 'inventory', name: 'Release strategic stock', qualification: 'qualified', specFit: 'meets', capacity: '3 t available', quantityAvailable: 3, leadTimeDays: 2, note: 'Reduces buffer for other programmes; approval needed.' },
  { id: 'O-T-4', alertId: 'AL-T-001', type: 'sourcing', name: 'Spot purchase via trader', qualification: 'qualified', specFit: 'meets', capacity: '2 t (spot)', unitPrice: 52000, leadTimeDays: 30, quoteValidUntil: '2026-11-20', note: 'Quote expires soon. Price is spot and volatile.' },
]
