/**
 * Salary (CTC) breakup + statutory deductions. Pure functions – no database.
 *
 * Rules are data (PayrollRules) so HR can change percentages / statutory
 * settings without code changes. Every approved salary structure stores the
 * rules it was calculated with, so old structures never change when the rules
 * are edited later.
 */

export interface SalaryComponentRule {
  /** Stable id, e.g. "basic". */
  key: string;
  name: string;
  /** % of CTC. All components together must be exactly 100. */
  percent: number;
  /** Counted in the PF wage (normally only Basic). */
  pfEligible: boolean;
  /** Receives the rupee rounding difference so the total equals the CTC exactly. */
  balancing?: boolean;
}

export interface PtSlab {
  /** Monthly gross from (inclusive). */
  min: number;
  /** Monthly gross up to (inclusive); null = no upper limit. */
  max: number | null;
  /** PT per month. */
  amount: number;
}

export interface PtStateRule {
  state: string;
  slabs: PtSlab[];
  /** Some states charge a different amount in February (e.g. Maharashtra ₹300). */
  februaryAmount?: number | null;
}

export interface StatutoryRules {
  pf: {
    enabled: boolean;
    /** Employee share, % of PF wage. */
    employeeRate: number;
    /** Employer share, % of PF wage (shown as employer contribution). */
    employerRate: number;
    /** Statutory wage ceiling (₹15,000 today). */
    wageCeiling: number;
    /** true = PF on min(PF wage, ceiling); false = PF on the full PF wage. */
    capAtCeiling: boolean;
  };
  esi: {
    enabled: boolean;
    employeeRate: number;
    employerRate: number;
    /** ESI applies only when monthly gross is at or below this (₹21,000 today). */
    grossLimit: number;
  };
  pt: {
    enabled: boolean;
    /** Used when the employee's state has no rule. Empty = no PT. */
    defaultState: string;
    states: PtStateRule[];
  };
  tds?: {
    /**
     * Employees who did not opt for PF get this % of gross deducted as TDS
     * automatically (unless a manual monthly TDS is set). Client rule: 2%.
     */
    noPfPercent: number;
  };
}

export interface PayrollRules {
  version: number;
  components: SalaryComponentRule[];
  statutory: StatutoryRules;
}

export const DEFAULT_COMPONENTS: SalaryComponentRule[] = [
  { key: 'basic', name: 'Basic Salary', percent: 40, pfEligible: true },
  { key: 'hra', name: 'House Rent Allowance (HRA)', percent: 20, pfEligible: false },
  { key: 'special', name: 'Special Allowance', percent: 25, pfEligible: false, balancing: true },
  { key: 'conveyance', name: 'Conveyance Allowance', percent: 5, pfEligible: false },
  { key: 'medical', name: 'Medical Allowance', percent: 5, pfEligible: false },
  { key: 'other', name: 'Other Allowance', percent: 5, pfEligible: false },
];

/**
 * Starting statutory values. HR must confirm them (and add the states where
 * employees work) in Payroll → Salary rules; PT differs by state.
 */
export const DEFAULT_STATUTORY: StatutoryRules = {
  pf: { enabled: true, employeeRate: 12, employerRate: 12, wageCeiling: 15000, capAtCeiling: true },
  esi: { enabled: true, employeeRate: 0.75, employerRate: 3.25, grossLimit: 21000 },
  pt: {
    enabled: true,
    defaultState: '',
    states: [
      {
        state: 'Maharashtra',
        slabs: [
          { min: 0, max: 7500, amount: 0 },
          { min: 7501, max: 10000, amount: 175 },
          { min: 10001, max: null, amount: 200 },
        ],
        februaryAmount: 300,
      },
      {
        state: 'Karnataka',
        slabs: [
          { min: 0, max: 24999, amount: 0 },
          { min: 25000, max: null, amount: 200 },
        ],
        februaryAmount: null,
      },
    ],
  },
  tds: { noPfPercent: 2 },
};

export interface SalaryInput {
  annualCtc: number;
  /** Employee's work / residence state for Professional Tax. */
  ptState?: string | null;
  /** false = employee opted out / not covered. Default true. */
  pfApplicable?: boolean;
  /** 'auto' (default) = by gross limit; true / false to force. */
  esiApplicable?: boolean | 'auto';
  /** Monthly TDS (from the tax projection / declarations); 0 if none. */
  tdsMonthly?: number;
  otherDeductions?: { name: string; amount: number }[];
  /** Optional insurance premium per year, recovered monthly (annual / 12). */
  insuranceAnnual?: number;
}

export interface BreakupLine {
  key: string;
  name: string;
  percent?: number;
  monthly: number;
  annual: number;
  note?: string;
}

export interface SalaryBreakup {
  annualCtc: number;
  monthlyCtc: number;
  earnings: BreakupLine[];
  grossMonthly: number;
  grossAnnual: number;
  deductions: BreakupLine[];
  totalDeductionsMonthly: number;
  totalDeductionsAnnual: number;
  netMonthly: number;
  netAnnual: number;
  /** Paid by the company on top of / outside the breakup (information). */
  employerContributions: BreakupLine[];
  pfWageMonthly: number;
  pfApplicable: boolean;
  esiApplicable: boolean;
  ptState: string | null;
  rulesVersion: number;
  /** TDS was calculated automatically (employee did not opt for PF). */
  tdsAuto?: boolean;
  insuranceAnnual?: number;
}

const r =(n: number) => Math.round(n);

export function validateRules(rules: Pick<PayrollRules, 'components' | 'statutory'>): string[] {
  const errors: string[] = [];
  const comps = rules.components || [];
  if (!comps.length) errors.push('Add at least one salary component');
  const total = Math.round(comps.reduce((s, c) => s + Number(c.percent || 0), 0) * 100) / 100;
  if (total !== 100) errors.push(`Salary components must add up to 100% of CTC (now ${total}%)`);
  const keys = new Set<string>();
  for (const c of comps) {
    if (!c.key || !/^[a-z0-9_]+$/.test(c.key)) errors.push(`Invalid component key "${c.key}" (use lowercase letters, numbers, _)`);
    if (keys.has(c.key)) errors.push(`Duplicate component key "${c.key}"`);
    keys.add(c.key);
    if (!c.name?.trim()) errors.push('Every component needs a name');
    if (!(Number(c.percent) >= 0)) errors.push(`${c.name || c.key}: percent must be 0 or more`);
  }
  if (comps.filter((c) => c.balancing).length > 1) errors.push('Only one component can take the rounding difference');
  if (!comps.some((c) => c.pfEligible)) errors.push('Mark at least one component (normally Basic) as PF eligible');

  const s = rules.statutory;
  const pct = (v: any) => Number(v) >= 0 && Number(v) <= 100;
  if (!pct(s?.pf?.employeeRate) || !pct(s?.pf?.employerRate)) errors.push('PF rates must be between 0 and 100');
  if (!(Number(s?.pf?.wageCeiling) >= 0)) errors.push('PF wage ceiling must be 0 or more');
  if (!pct(s?.esi?.employeeRate) || !pct(s?.esi?.employerRate)) errors.push('ESI rates must be between 0 and 100');
  if (!(Number(s?.esi?.grossLimit) >= 0)) errors.push('ESI gross limit must be 0 or more');
  if (s?.tds && !pct(s.tds.noPfPercent)) errors.push('Auto TDS % (PF not opted) must be between 0 and 100');
  for (const st of s?.pt?.states || []) {
    if (!st.state?.trim()) errors.push('Every PT rule needs a state');
    for (const sl of st.slabs || []) {
      if (!(Number(sl.min) >= 0) || !(Number(sl.amount) >= 0)) errors.push(`${st.state}: PT slab values must be 0 or more`);
      if (sl.max !== null && sl.max !== undefined && Number(sl.max) < Number(sl.min)) errors.push(`${st.state}: slab "to" is below "from"`);
    }
  }
  return errors;
}

function findPtRule(rules: StatutoryRules, state?: string | null) {
  const norm = (v?: string | null) => String(v || '').trim().toLowerCase();
  const want = norm(state);
  return (
    (want && rules.pt.states.find((s) => norm(s.state) === want)) ||
    (rules.pt.defaultState && rules.pt.states.find((s) => norm(s.state) === norm(rules.pt.defaultState))) ||
    null
  );
}

/** PT for one month of `gross`. `month` 1–12 (February may differ). */
export function professionalTax(rules: StatutoryRules, state: string | null | undefined, gross: number, month?: number) {
  if (!rules.pt.enabled) return { amount: 0, state: null as string | null };
  const rule = findPtRule(rules, state);
  if (!rule) return { amount: 0, state: null as string | null };
  const slab = rule.slabs.find((s) => gross >= s.min && (s.max === null || s.max === undefined || gross <= s.max));
  let amount = slab ? Number(slab.amount) : 0;
  if (month === 2 && amount > 0 && rule.februaryAmount) amount = Number(rule.februaryAmount);
  return { amount, state: rule.state };
}

export function calculateSalary(rules: PayrollRules, input: SalaryInput): SalaryBreakup {
  const annualCtc = Math.max(0, r(Number(input.annualCtc) || 0));
  const monthlyCtc = r(annualCtc / 12);
  const comps = rules.components;

  // Earnings: % of monthly CTC, rounded to the rupee; the balancing component
  // (or the last one) takes the rounding difference so the total is exact.
  const earnings: BreakupLine[] = comps.map((c) => {
    const monthly = r((monthlyCtc * Number(c.percent)) / 100);
    return { key: c.key, name: c.name, percent: Number(c.percent), monthly, annual: 0 };
  });
  const diff = monthlyCtc - earnings.reduce((s, e) => s + e.monthly, 0);
  if (diff && earnings.length) {
    const idx = Math.max(0, comps.findIndex((c) => c.balancing));
    const target = comps.some((c) => c.balancing) ? idx : earnings.length - 1;
    earnings[target].monthly += diff;
  }
  earnings.forEach((e) => (e.annual = e.monthly * 12));
  const grossMonthly = earnings.reduce((s, e) => s + e.monthly, 0);

  const st = rules.statutory;
  const deductions: BreakupLine[] = [];
  const employerContributions: BreakupLine[] = [];

  // PF: % of PF-eligible wage (Basic), optionally capped at the ceiling
  const pfWageFull = earnings.filter((e) => comps.find((c) => c.key === e.key)?.pfEligible).reduce((s, e) => s + e.monthly, 0);
  const pfApplicable = st.pf.enabled && input.pfApplicable !== false && pfWageFull > 0;
  const pfWage = st.pf.capAtCeiling ? Math.min(pfWageFull, st.pf.wageCeiling) : pfWageFull;
  if (pfApplicable) {
    const emp = r((pfWage * st.pf.employeeRate) / 100);
    const er = r((pfWage * st.pf.employerRate) / 100);
    const note = `${st.pf.employeeRate}% of PF wage ₹${pfWage.toLocaleString('en-IN')}${st.pf.capAtCeiling && pfWageFull > st.pf.wageCeiling ? ' (capped)' : ''}`;
    deductions.push({ key: 'pf', name: 'Employee PF', monthly: emp, annual: emp * 12, note });
    employerContributions.push({ key: 'pf_employer', name: 'Employer PF', monthly: er, annual: er * 12, note: `${st.pf.employerRate}% of PF wage` });
  }

  // ESI: only when gross is within the limit (or forced)
  const esiAuto = grossMonthly <= st.esi.grossLimit;
  const esiApplicable = st.esi.enabled && (input.esiApplicable === undefined || input.esiApplicable === 'auto' ? esiAuto : !!input.esiApplicable);
  if (esiApplicable) {
    const emp = Math.ceil((grossMonthly * st.esi.employeeRate) / 100);
    const er = Math.ceil((grossMonthly * st.esi.employerRate) / 100);
    deductions.push({ key: 'esi', name: 'Employee ESI', monthly: emp, annual: emp * 12, note: `${st.esi.employeeRate}% of gross` });
    employerContributions.push({ key: 'esi_employer', name: 'Employer ESI', monthly: er, annual: er * 12, note: `${st.esi.employerRate}% of gross` });
  }

  // Professional Tax: state slab; February may differ
  const ptNormal = professionalTax(st, input.ptState, grossMonthly);
  const ptFeb = professionalTax(st, input.ptState, grossMonthly, 2);
  if (ptNormal.amount > 0 || ptFeb.amount > 0) {
    deductions.push({
      key: 'pt',
      name: 'Professional Tax',
      monthly: ptNormal.amount,
      annual: ptNormal.amount * 11 + ptFeb.amount,
      note: `${ptNormal.state}${ptFeb.amount !== ptNormal.amount ? ` (₹${ptFeb.amount} in February)` : ''}`,
    });
  }

  // TDS: manual monthly amount, otherwise auto % when the employee did not
  // opt for PF (client rule, default 2% of gross).
  const manualTds = Math.max(0, r(Number(input.tdsMonthly) || 0));
  const noPfPercent = Number(st.tds?.noPfPercent ?? 2);
  const tdsAuto = !manualTds && input.pfApplicable === false && noPfPercent > 0;
  const tds = manualTds || (tdsAuto ? r((grossMonthly * noPfPercent) / 100) : 0);
  if (tds) {
    deductions.push({
      key: 'tds',
      name: 'Income Tax / TDS',
      monthly: tds,
      annual: tds * 12,
      note: tdsAuto ? `${noPfPercent}% of gross (PF not opted)` : 'As applicable',
    });
  }

  const insuranceAnnual = Math.max(0, r(Number(input.insuranceAnnual) || 0));
  if (insuranceAnnual) {
    const m = r(insuranceAnnual / 12);
    deductions.push({ key: 'insurance', name: 'Insurance', monthly: m, annual: insuranceAnnual, note: `₹${insuranceAnnual.toLocaleString('en-IN')} per year` });
  }

  for (const [i, o] of (input.otherDeductions || []).entries()) {
    const amt = Math.max(0, r(Number(o.amount) || 0));
    if (amt) deductions.push({ key: `other_${i + 1}`, name: o.name?.trim() || 'Other deduction', monthly: amt, annual: amt * 12 });
  }

  const totalDeductionsMonthly = deductions.reduce((s, d) => s + d.monthly, 0);
  const totalDeductionsAnnual = deductions.reduce((s, d) => s + d.annual, 0);

  return {
    annualCtc,
    monthlyCtc,
    earnings,
    grossMonthly,
    grossAnnual: grossMonthly * 12,
    deductions,
    totalDeductionsMonthly,
    totalDeductionsAnnual,
    netMonthly: grossMonthly - totalDeductionsMonthly,
    netAnnual: grossMonthly * 12 - totalDeductionsAnnual,
    employerContributions,
    pfWageMonthly: pfApplicable ? pfWage : 0,
    pfApplicable,
    esiApplicable,
    ptState: ptNormal.state ?? ptFeb.state ?? null,
    rulesVersion: rules.version,
    tdsAuto,
    insuranceAnnual,
  };
}

/* ------------------------------------------------------------------ */
/* Monthly payroll (one employee, one month)                           */
/* ------------------------------------------------------------------ */

export type AdjustmentKind = 'earning' | 'deduction';

/** Adjustment types. Earnings add to gross, deductions to deductions. */
export const ADJUSTMENT_TYPES: Record<string, { label: string; kind: AdjustmentKind }> = {
  incentive: { label: 'Incentive', kind: 'earning' },
  bonus: { label: 'Bonus', kind: 'earning' },
  arrear: { label: 'Arrear', kind: 'earning' },
  reimbursement: { label: 'Reimbursement', kind: 'earning' },
  other_earning: { label: 'Other Earning', kind: 'earning' },
  recovery: { label: 'Recovery', kind: 'deduction' },
  advance: { label: 'Loan / Salary Advance', kind: 'deduction' },
  other_deduction: { label: 'Other Deduction', kind: 'deduction' },
};

export interface MonthlyAdjustment {
  id: string;
  type: string;
  kind: AdjustmentKind;
  name: string;
  amount: number;
}

export interface MonthlyStructure {
  breakup: SalaryBreakup;
  rules: PayrollRules;
  ptState?: string | null;
  tdsMonthly?: number;
  insuranceAnnual?: number;
  otherDeductions?: { name: string; amount: number }[];
}

export interface PayLine {
  key: string;
  name: string;
  /** Monthly amount as per the salary structure (before LOP). */
  reference?: number;
  amount: number;
  arrear?: number;
  note?: string;
  adjustmentId?: string;
}

export interface MonthlyPay {
  daysInMonth: number;
  lopDays: number;
  payableDays: number;
  earnings: PayLine[];
  grossEarnings: number;
  deductions: PayLine[];
  totalDeductions: number;
  netPay: number;
  employerContributions: PayLine[];
  /** Gross + employer contributions (cost to company for the month). */
  monthlyCost: number;
}

/** Earnings that are not wages (no PF / ESI / PT / TDS on them). */
const NON_WAGE_TYPES = new Set(['reimbursement']);

export function calculateMonthlyPay(
  structure: MonthlyStructure,
  opts: { daysInMonth: number; lopDays: number; month: number; adjustments?: MonthlyAdjustment[] },
): MonthlyPay {
  const days = Math.max(1, Math.round(opts.daysInMonth));
  const lop = Math.min(days, Math.max(0, Number(opts.lopDays) || 0));
  const payableDays = Math.round((days - lop) * 100) / 100;
  const factor = payableDays / days;
  const b = structure.breakup;
  const st = structure.rules.statutory;
  const comps = structure.rules.components || [];
  const adjustments = (opts.adjustments || []).filter((a) => Number(a.amount) > 0);

  // Structure earnings, prorated for loss of pay
  const earnings: PayLine[] = (b.earnings || []).map((e) => ({
    key: e.key,
    name: e.name,
    reference: e.monthly,
    amount: r(e.monthly * factor),
  }));
  for (const a of adjustments.filter((x) => x.kind === 'earning')) {
    const amt = r(Number(a.amount));
    const isArrear = a.type === 'arrear';
    earnings.push({
      key: `adj_${a.id}`,
      name: a.name,
      amount: isArrear ? 0 : amt,
      ...(isArrear ? { arrear: amt } : {}),
      adjustmentId: a.id,
      note: a.type,
    });
  }
  const grossEarnings = earnings.reduce((s, e) => s + e.amount + (e.arrear || 0), 0);
  const nonWage = adjustments
    .filter((a) => a.kind === 'earning' && NON_WAGE_TYPES.has(a.type))
    .reduce((s, a) => s + r(Number(a.amount)), 0);
  const wageGross = grossEarnings - nonWage;

  const deductions: PayLine[] = [];
  const employerContributions: PayLine[] = [];
  const refLine = (key: string) => (b.deductions || []).find((d) => d.key === key)?.monthly;

  // PF on the prorated PF wage
  if (b.pfApplicable && st.pf?.enabled !== false) {
    const pfWageFull = earnings
      .filter((e) => comps.find((c) => c.key === e.key)?.pfEligible)
      .reduce((s, e) => s + e.amount, 0);
    const pfWage = st.pf.capAtCeiling ? Math.min(pfWageFull, st.pf.wageCeiling) : pfWageFull;
    const emp = r((pfWage * st.pf.employeeRate) / 100);
    const er = r((pfWage * st.pf.employerRate) / 100);
    if (emp) deductions.push({ key: 'pf', name: 'Provident Fund (PF)', reference: refLine('pf'), amount: emp });
    if (er) employerContributions.push({ key: 'pf_employer', name: 'Employer Contribution to PF', amount: er });
  }

  // ESI (applicability decided when the structure was approved)
  if (b.esiApplicable && st.esi?.enabled !== false) {
    const emp = Math.ceil((wageGross * st.esi.employeeRate) / 100);
    const er = Math.ceil((wageGross * st.esi.employerRate) / 100);
    if (emp) deductions.push({ key: 'esi', name: 'Employee State Insurance (ESI)', reference: refLine('esi'), amount: emp });
    if (er) employerContributions.push({ key: 'esi_employer', name: 'Employer Contribution to ESI', amount: er });
  }

  // Professional Tax on this month's wages (February may differ)
  const pt = professionalTax(st, structure.ptState ?? b.ptState, wageGross, opts.month);
  if (pt.amount) deductions.push({ key: 'pt', name: 'Professional Tax', reference: refLine('pt'), amount: pt.amount });

  // TDS: manual monthly, or auto % of wages when PF was not opted
  const manualTds = Math.max(0, r(Number(structure.tdsMonthly) || 0));
  const noPfPercent = Number(st.tds?.noPfPercent ?? 2);
  const tds = manualTds || (b.tdsAuto ? r((wageGross * noPfPercent) / 100) : 0);
  if (tds) {
    deductions.push({
      key: 'tds',
      name: 'Income Tax / TDS',
      reference: refLine('tds'),
      amount: tds,
      ...(!manualTds && b.tdsAuto ? { note: `${noPfPercent}% (PF not opted)` } : {}),
    });
  }

  const insuranceAnnual = Math.max(0, r(Number(structure.insuranceAnnual ?? b.insuranceAnnual) || 0));
  if (insuranceAnnual) {
    const m = r(insuranceAnnual / 12);
    deductions.push({ key: 'insurance', name: 'Insurance', reference: m, amount: m });
  }

  for (const [i, o] of (structure.otherDeductions || []).entries()) {
    const amt = Math.max(0, r(Number(o.amount) || 0));
    if (amt) deductions.push({ key: `other_${i + 1}`, name: o.name?.trim() || 'Other Deductions', reference: amt, amount: amt });
  }

  for (const a of adjustments.filter((x) => x.kind === 'deduction')) {
    deductions.push({ key: `adj_${a.id}`, name: a.name, amount: r(Number(a.amount)), adjustmentId: a.id, note: a.type });
  }

  const totalDeductions = deductions.reduce((s, d) => s + d.amount, 0);
  const employerTotal = employerContributions.reduce((s, e) => s + e.amount, 0);
  return {
    daysInMonth: days,
    lopDays: lop,
    payableDays,
    earnings,
    grossEarnings,
    deductions,
    totalDeductions,
    netPay: grossEarnings - totalDeductions,
    employerContributions,
    monthlyCost: grossEarnings + employerTotal,
  };
}

/** Indian numbering in words, e.g. 125000 → "One Lakh Twenty Five Thousand Rupees Only". */
export function amountInWords(amount: number): string {
  const n = Math.round(Math.abs(Number(amount) || 0));
  if (n === 0) return 'Zero Rupees Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ''}`);
  const three = (x: number) => {
    const h = Math.floor(x / 100);
    const rest = x % 100;
    return [h ? `${ones[h]} Hundred` : '', rest ? two(rest) : ''].filter(Boolean).join(' ');
  };
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${crore >= 100 ? three(crore) : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return `${parts.join(' ')} Rupees Only`;
}
