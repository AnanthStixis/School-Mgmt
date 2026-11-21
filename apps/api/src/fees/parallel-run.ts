import { BadRequestException, Injectable } from '@nestjs/common';
import { PARALLEL_RUN_ALIASES, PARALLEL_RUN_COLUMNS, parseLooseDate, parseRupees, type ParallelRunDto, type ParallelRunRow, type ParallelStatus } from '@sms/shared';
import type { AuthUser } from '../auth/auth-user';
import { dayDate, dayString } from '../common/dates';
import { requireTenant } from '../common/scope';
import { ScopeService } from '../common/scope.service';
import { readRecords } from '../imports/csv';
import { PrismaService } from '../prisma/prisma.service';
import { FeesService } from './fees.service';

export interface Payment {
  date: string;
  admissionNo: string;
  amount: number;
  receiptNo: string;
  studentName?: string;
}

const ORDER: Record<ParallelStatus, number> = { DIFFERENT: 0, ONLY_THEIRS: 1, ONLY_OURS: 2, MATCH: 3 };

/**
 * Matches the old system's collections with ours, per student per day. Receipt numbers differ between
 * the two systems while both run, so the match is on admission number + date, comparing the day's total.
 */
export function compareCollections(theirs: Payment[], ours: Payment[]): ParallelRunRow[] {
  const key = (p: Payment) => `${p.date}|${p.admissionNo.toUpperCase()}`;
  const groups = new Map<string, ParallelRunRow>();
  const get = (p: Payment) => {
    let g = groups.get(key(p));
    if (!g) {
      g = { date: p.date, admissionNo: p.admissionNo.toUpperCase(), studentName: '', status: 'MATCH', theirs: { count: 0, total: 0, receipts: [] }, ours: { count: 0, total: 0, receipts: [] } };
      groups.set(key(p), g);
    }
    if (!g.studentName && p.studentName) g.studentName = p.studentName;
    return g;
  };
  for (const p of theirs) {
    const g = get(p).theirs;
    g.count++;
    g.total += p.amount;
    if (p.receiptNo) g.receipts.push(p.receiptNo);
  }
  for (const p of ours) {
    const g = get(p).ours;
    g.count++;
    g.total += p.amount;
    g.receipts.push(p.receiptNo);
  }
  const rows = [...groups.values()].map((g) => ({
    ...g,
    status: (!g.ours.count ? 'ONLY_THEIRS' : !g.theirs.count ? 'ONLY_OURS' : g.ours.total === g.theirs.total ? 'MATCH' : 'DIFFERENT') as ParallelStatus,
  }));
  return rows.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.date.localeCompare(b.date) || a.admissionNo.localeCompare(b.admissionNo));
}

/**
 * Parallel run: while both systems are used, Accounts uploads SchoolElement's Daily Transaction
 * export and sees, per student and day, where the two disagree. Nothing is stored.
 */
@Injectable()
export class ParallelRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async compare(user: AuthUser, input: { branchId?: string; csv: string }): Promise<ParallelRunDto> {
    FeesService.assertStaff(user);
    const filter = await this.scope.branchFilter(user, input.branchId);
    const { records, headerErrors, ignored } = readRecords(input.csv, PARALLEL_RUN_COLUMNS, ['paid_date', 'admission_no', 'amount'], { aliases: PARALLEL_RUN_ALIASES, ignoreUnknown: true });
    if (headerErrors.length) throw new BadRequestException(headerErrors);
    if (!records.length) throw new BadRequestException('The file has a header but no rows');
    if (records.length > 20_000) throw new BadRequestException('At most 20,000 rows per file');

    const fileErrors: { line: number; error: string }[] = [];
    const theirs: Payment[] = [];
    for (const r of records) {
      const d = r.data;
      // Only successful transactions count (the export also lists failed / cancelled ones when a status column exists).
      if (d.status && !/^(success|successful|paid|completed)$/i.test(d.status)) continue;
      const date = parseLooseDate(d.paid_date ?? '');
      const amount = parseRupees(d.amount ?? '');
      if (!date) fileErrors.push({ line: r.line, error: `paid_date "${d.paid_date}" is not a date` });
      else if (amount === null) fileErrors.push({ line: r.line, error: `amount "${d.amount}" is not a whole number of rupees` });
      else if (!d.admission_no) fileErrors.push({ line: r.line, error: 'admission_no is missing' });
      else theirs.push({ date, admissionNo: d.admission_no, amount, receiptNo: d.receipt_no ?? '', studentName: d.student });
    }
    if (!theirs.length) throw new BadRequestException(fileErrors.length ? `No usable rows: ${fileErrors[0].error} (line ${fileErrors[0].line})` : 'No successful transactions in the file');

    const dates = theirs.map((p) => p.date).sort();
    const from = dates[0];
    const to = dates[dates.length - 1];
    const receipts = await this.prisma.feeReceipt.findMany({
      where: { tenantId: requireTenant(user), ...(filter.branchId ? { branchId: filter.branchId } : {}), status: 'SUCCESS', date: { gte: dayDate(from), lte: dayDate(to) } },
      select: { no: true, date: true, total: true, student: { select: { admissionNo: true, name: true } } },
    });
    const ours: Payment[] = receipts.map((r) => ({ date: dayString(r.date), admissionNo: r.student.admissionNo, amount: r.total, receiptNo: r.no, studentName: r.student.name }));
    const rows = compareCollections(theirs, ours);
    const count = (s: ParallelStatus) => rows.filter((r) => r.status === s).length;
    return {
      from,
      to,
      rows,
      totals: { theirs: theirs.reduce((n, p) => n + p.amount, 0), ours: ours.reduce((n, p) => n + p.amount, 0), matched: count('MATCH'), different: count('DIFFERENT'), onlyTheirs: count('ONLY_THEIRS'), onlyOurs: count('ONLY_OURS') },
      fileErrors: fileErrors.slice(0, 200),
      ignoredColumns: ignored,
    };
  }
}
