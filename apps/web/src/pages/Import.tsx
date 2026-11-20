import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { STAFF_IMPORT_COLUMNS, STUDENT_IMPORT_COLUMNS, type ImportResult } from '@sms/shared';
import { api, saveText } from '../lib/api';
import { NeedsBranch } from '../components/BranchPicker';
import { useScope } from '../lib/scope';
import { Badge, Button, Card, ErrorBox, PageHeader, Table } from '../components/ui';

type Kind = 'students' | 'staff';
const MAX_BYTES = 5 * 1024 * 1024;

/** Bulk import with a mandatory check first: nothing is saved until every row is valid. */
export function Import() {
  const { kind } = useParams();
  if (kind !== 'students' && kind !== 'staff') return <Navigate to="/students" replace />;
  return (
    <div>
      <PageHeader
        title={kind === 'students' ? 'Import students' : 'Import staff'}
        sub="Upload a CSV file. We check every row first and import nothing until all rows are valid."
        actions={
          <Link to={`/${kind}`}>
            <Button>‹ Back</Button>
          </Link>
        }
      />
      <NeedsBranch>{(branchId) => <ImportFlow key={`${kind}-${branchId}`} kind={kind} branchId={branchId} />}</NeedsBranch>
    </div>
  );
}

function ImportFlow({ kind, branchId }: { kind: Kind; branchId: string }) {
  const qc = useQueryClient();
  const { branchName } = useScope();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const columns = kind === 'students' ? STUDENT_IMPORT_COLUMNS : STAFF_IMPORT_COLUMNS;

  const template = useMutation({ mutationFn: () => api.importTemplate(kind), onSuccess: (t) => saveText(`${kind}-template.csv`, t) });
  const validate = useMutation({ mutationFn: (text: string) => api.importCsv(kind, branchId, text, true), onSuccess: setCheck });
  const commit = useMutation({
    mutationFn: () => api.importCsv(kind, branchId, file!.text, false),
    onSuccess: (r) => {
      if (r.invalid) setCheck(r);
      else {
        setDone(r);
        void qc.invalidateQueries({ queryKey: [kind] });
        void qc.invalidateQueries({ queryKey: ['classes'] });
      }
    },
  });

  const onFile = async (f: File | undefined) => {
    setCheck(null);
    setDone(null);
    setFileError(null);
    validate.reset();
    commit.reset();
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) return setFileError('The file is larger than 5 MB. Split it into smaller files.');
    const text = await f.text();
    setFile({ name: f.name, text });
    validate.mutate(text);
  };

  if (done) {
    return (
      <Card>
        <p className="text-lg">
          ✅ Imported <b>{done.created}</b> {kind} into {branchName(branchId)}.
        </p>
        <div className="mt-3 flex gap-2">
          <Link to={`/${kind}`}>
            <Button variant="primary">View {kind}</Button>
          </Link>
          <Button onClick={() => onFile(undefined)}>Import another file</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="1. Get the template">
        <p className="mb-2 text-sm">
          Fill in one row per {kind === 'students' ? 'student' : 'staff member'}. Columns: <span className="font-mono text-xs">{columns.join(', ')}</span>
        </p>
        <ul className="mb-3 list-disc pl-5 text-sm text-muted">
          {kind === 'students' ? (
            <>
              <li>Required: name, guardian_name, guardian_phone. Leave admission_no blank to have one generated.</li>
              <li>class must match a class name in Academic Setup exactly, e.g. 8-A. Dates as YYYY-MM-DD or DD-MM-YYYY.</li>
              <li>Students whose guardian mobile is already on file are linked to that parent as siblings.</li>
            </>
          ) : (
            <>
              <li>Required: name, role. access is one of none, teacher, accounts (manager only for the School Admin).</li>
              <li>Staff with a login need a mobile number; they sign in with a code sent to it.</li>
            </>
          )}
        </ul>
        <ErrorBox error={template.error} />
        <Button onClick={() => template.mutate()} disabled={template.isPending}>
          ⬇ Download template
        </Button>
      </Card>

      <Card title={`2. Upload your file to ${branchName(branchId)}`}>
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm" />
        {fileError && <p className="mt-2 text-sm text-red-700">{fileError}</p>}
        <div className="mt-3">
          <ErrorBox error={validate.error ?? commit.error} />
        </div>
        {validate.isPending && <p className="mt-2 text-muted">Checking {file?.name}…</p>}
      </Card>

      {check && (
        <Card title="3. Check and import">
          <div className="mb-3 flex flex-wrap gap-2">
            <Badge>{check.total} rows</Badge>
            <Badge tone="green">{check.valid} ready</Badge>
            {check.invalid > 0 && <Badge tone="red">{check.invalid} with problems</Badge>}
          </div>
          {check.invalid > 0 ? (
            <>
              <p className="mb-2 text-sm">Fix these rows in your file and upload it again. Nothing has been imported.</p>
              <Table
                rows={check.rows}
                rowKey={(r) => String(r.line)}
                columns={[
                  { header: 'Line', cell: (r) => r.line },
                  { header: 'Name', cell: (r) => r.data.name || <span className="text-muted">(blank)</span> },
                  {
                    header: 'Problems',
                    cell: (r) => (
                      <ul className="list-disc pl-4 text-red-700">
                        {r.errors.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <>
              <p className="mb-3 text-sm">All rows look good.</p>
              <Button variant="primary" disabled={commit.isPending} onClick={() => commit.mutate()}>
                {commit.isPending ? 'Importing…' : `Import ${check.valid} ${kind}`}
              </Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
