import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { uploadCrmInventory, getCrmInventoryInfo } from '../utils/uploadCrmInventory';
import { enrichBranch, exportEnrichmentResults } from '../utils/enrichBranch';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Upload,
  Database,
  CheckCircle2,
  XCircle,
  Sparkles,
  FileSpreadsheet,
  RefreshCw,
} from 'lucide-react';

export default function EnrichmentPage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // CRM upload state
  const [crmInfo, setCrmInfo] = useState({ count: 0, uploadedAt: null });
  const [uploadProgress, setUploadProgress] = useState(null); // { phase, current, total, message }
  const [isUploading, setIsUploading] = useState(false);

  // Branch data
  const [branches, setBranches] = useState([]); // [{ branch, scanCount }]
  const [loadingBranches, setLoadingBranches] = useState(true);

  // Enrichment state
  const [enrichingId, setEnrichingId] = useState(null);
  const [enrichProgress, setEnrichProgress] = useState(null); // { current, total, message }
  const [enrichResult, setEnrichResult] = useState(null); // { branchId, passCount, failCount, results }

  // Load CRM inventory info and branch data on mount
  useEffect(() => {
    loadCrmInfo();
    loadBranches();
  }, []);

  async function loadCrmInfo() {
    const info = await getCrmInventoryInfo();
    setCrmInfo(info);
  }

  async function loadBranches() {
    setLoadingBranches(true);
    try {
      const { data: branchData, error: branchError } = await supabase
        .from('branches')
        .select('id, name')
        .order('name');
      if (branchError) throw branchError;

      // Get scan counts per branch
      const branchList = await Promise.all(
        (branchData || []).map(async (branch) => {
          const { count } = await supabase
            .from('scans')
            .select('*', { count: 'exact', head: true })
            .eq('branch_id', branch.id);
          return { branch, scanCount: count || 0 };
        })
      );

      setBranches(branchList);
    } catch (err) {
      console.error('Failed to load branches:', err);
      toast.error('Failed to load branch data.');
    } finally {
      setLoadingBranches(false);
    }
  }

  // Handle file upload
  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = [
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    const isValid = validTypes.includes(file.type) ||
      file.name.endsWith('.csv') ||
      file.name.endsWith('.xlsx') ||
      file.name.endsWith('.xls');

    if (!isValid) {
      toast.error('Please upload a .csv or .xlsx file.');
      return;
    }

    setIsUploading(true);
    setUploadProgress({ phase: 'starting', current: 0, total: 0, message: 'Starting upload...' });

    try {
      const result = await uploadCrmInventory(file, (progress) => {
        setUploadProgress(progress);
      });

      toast.success(`Uploaded ${result.totalRecords.toLocaleString()} records successfully!`);
      await loadCrmInfo();
    } catch (err) {
      console.error('Upload failed:', err);
      toast.error(err.message || 'Upload failed.');
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      // Reset input so the same file can be re-uploaded
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Handle enrichment for a branch
  async function handleEnrich(branchItem) {
    if (crmInfo.count === 0) {
      toast.error('Please upload CRM inventory data first.');
      return;
    }

    setEnrichingId(branchItem.branch.id);
    setEnrichProgress({ current: 0, total: 0, message: 'Starting enrichment...' });
    setEnrichResult(null);

    try {
      const { results, passCount, failCount } = await enrichBranch(
        branchItem.branch.id,
        branchItem.branch.name,
        (progress) => setEnrichProgress(progress)
      );

      // Add branch name to all results
      const enrichedResults = results.map((r) => ({
        ...r,
        branch_name: branchItem.branch.name,
      }));

      setEnrichResult({
        branchId: branchItem.branch.id,
        branchName: branchItem.branch.name,
        passCount,
        failCount,
        results: enrichedResults,
      });

      // Auto-download the Excel
      exportEnrichmentResults(enrichedResults, branchItem.branch.name);
      toast.success(
        `Enrichment complete! ✅ ${passCount} passed, ❌ ${failCount} failed. File downloaded.`
      );
    } catch (err) {
      console.error('Enrichment failed:', err);
      toast.error(err.message || 'Enrichment failed.');
    } finally {
      setEnrichingId(null);
      setEnrichProgress(null);
    }
  }

  const uploadedAtFormatted = crmInfo.uploadedAt
    ? new Date(crmInfo.uploadedAt).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="app-container">
      <div className="page" style={{ paddingBottom: '2rem' }}>
        {/* Header */}
        <div className="page-header">
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              padding: 0,
              marginBottom: '0.75rem',
              minHeight: 'var(--min-touch)',
            }}
          >
            <ArrowLeft size={18} />
            Back to Dashboard
          </button>
          <h1 className="page-title">
            <Sparkles size={24} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Data Enrichment
          </h1>
          <p className="page-subtitle">
            Validate scanned data against CRM inventory
          </p>
        </div>

        {/* ====== Section 1: CRM Upload ====== */}
        <div
          className="card"
          style={{
            padding: '1.25rem',
            marginBottom: '1.25rem',
            border: '1.5px solid var(--color-border)',
            boxShadow: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <Database size={18} color="var(--color-primary)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>CRM Inventory Source</h2>
          </div>

          {/* Upload status */}
          {crmInfo.count > 0 ? (
            <div
              style={{
                padding: '0.75rem 1rem',
                background: 'rgba(34, 197, 94, 0.08)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                borderRadius: '0.625rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.25rem' }}>
                <CheckCircle2 size={16} color="var(--color-success)" />
                <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-success)' }}>
                  {crmInfo.count.toLocaleString()} records loaded
                </span>
              </div>
              {uploadedAtFormatted && (
                <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginLeft: '1.375rem' }}>
                  Last upload: {uploadedAtFormatted}
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: '0.75rem 1rem',
                background: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                borderRadius: '0.625rem',
                marginBottom: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <XCircle size={16} color="var(--color-error)" />
                <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-error)' }}>
                  No CRM data uploaded yet
                </span>
              </div>
            </div>
          )}

          {/* Upload progress */}
          {uploadProgress && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>
                {uploadProgress.message}
              </div>
              {uploadProgress.total > 0 && (
                <div style={{
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--color-border)',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 3,
                    background: 'var(--color-primary)',
                    width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              )}
            </div>
          )}

          {/* Upload button */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            id="crm-file-upload"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="btn-outline"
            style={{
              width: '100%',
              minHeight: 48,
              borderRadius: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              fontSize: '0.9375rem',
              fontWeight: 600,
              border: '2px dashed var(--color-border)',
              background: 'var(--color-bg)',
              cursor: isUploading ? 'wait' : 'pointer',
              color: isUploading ? 'var(--color-text-muted)' : 'var(--color-primary)',
            }}
          >
            {isUploading ? (
              <>
                <div className="spinner spinner-dark" style={{ width: 18, height: 18 }} />
                Uploading...
              </>
            ) : (
              <>
                {crmInfo.count > 0 ? <RefreshCw size={18} /> : <Upload size={18} />}
                {crmInfo.count > 0 ? 'Re-upload CRM Export' : 'Upload CRM Export (.csv / .xlsx)'}
              </>
            )}
          </button>
        </div>

        {/* ====== Section 2: Branch Enrichment ====== */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <FileSpreadsheet size={18} color="var(--color-primary)" />
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Branch Enrichment</h2>
        </div>

        {loadingBranches ? (
          <div className="flex items-center justify-center" style={{ minHeight: 150 }}>
            <div className="spinner spinner-dark" style={{ width: 36, height: 36 }} />
          </div>
        ) : branches.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted" style={{ minHeight: 150 }}>
            <p style={{ fontSize: '1rem', fontWeight: 600 }}>No branches found</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Enrichment result summary (if just completed) */}
            {enrichResult && (
              <div
                className="card"
                style={{
                  padding: '1rem 1.25rem',
                  border: 'none',
                  background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)',
                  color: '#fff',
                }}
              >
                <div style={{ fontSize: '0.8125rem', opacity: 0.8, fontWeight: 600 }}>
                  Last Enrichment: {enrichResult.branchName}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem' }}>
                  <div>
                    <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>{enrichResult.passCount}</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500, opacity: 0.7, marginLeft: '0.25rem' }}>
                      ✅ passed
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>{enrichResult.failCount}</span>
                    <span style={{ fontSize: '0.875rem', fontWeight: 500, opacity: 0.7, marginLeft: '0.25rem' }}>
                      ❌ failed
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.375rem' }}>
                  Excel file downloaded automatically
                </div>
              </div>
            )}

            {/* Branch list */}
            {branches.map((item) => {
              const isEnriching = enrichingId === item.branch.id;
              const hasNoScans = item.scanCount === 0;
              const noData = crmInfo.count === 0;

              return (
                <div
                  key={item.branch.id}
                  className="card"
                  style={{
                    padding: '1rem 1.25rem',
                    border: '1.5px solid var(--color-border)',
                    boxShadow: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                        {item.branch.name}
                      </div>
                      <span
                        className={`badge mt-1 ${item.scanCount > 0 ? 'badge-blue' : 'badge-gray'}`}
                      >
                        {item.scanCount.toLocaleString()} scan{item.scanCount !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <button
                      className="btn-outline"
                      onClick={() => handleEnrich(item)}
                      disabled={isEnriching || hasNoScans || noData}
                      style={{
                        width: 'auto',
                        minHeight: 40,
                        padding: '0.375rem 1rem',
                        fontSize: '0.875rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                        borderRadius: '0.625rem',
                        flexShrink: 0,
                        fontWeight: 700,
                        background: isEnriching
                          ? 'var(--color-border)'
                          : hasNoScans || noData
                          ? 'var(--color-bg)'
                          : 'rgba(37, 99, 235, 0.08)',
                        borderColor: isEnriching
                          ? 'var(--color-border)'
                          : hasNoScans || noData
                          ? 'var(--color-border)'
                          : 'var(--color-primary)',
                        color: hasNoScans || noData
                          ? 'var(--color-text-muted)'
                          : 'var(--color-primary)',
                        cursor: isEnriching || hasNoScans || noData ? 'not-allowed' : 'pointer',
                        opacity: hasNoScans ? 0.5 : 1,
                      }}
                    >
                      {isEnriching ? (
                        <div className="spinner spinner-dark" style={{ width: 16, height: 16 }} />
                      ) : (
                        <Sparkles size={15} />
                      )}
                      {isEnriching ? 'Enriching...' : 'Enrich'}
                    </button>
                  </div>

                  {/* Progress bar during enrichment */}
                  {isEnriching && enrichProgress && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
                        {enrichProgress.message}
                      </div>
                      {enrichProgress.total > 0 && (
                        <div style={{
                          height: 6,
                          borderRadius: 3,
                          background: 'var(--color-border)',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            borderRadius: 3,
                            background: 'linear-gradient(90deg, var(--color-primary), var(--color-success))',
                            width: `${Math.round((enrichProgress.current / enrichProgress.total) * 100)}%`,
                            transition: 'width 0.3s ease',
                          }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
