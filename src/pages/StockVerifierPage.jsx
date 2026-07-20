import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseSCRRegistry, getBranchNames, getSCRsForBranch } from '../utils/parseSCRRegistry';
import { parseTransferRecord } from '../utils/parseTransferRecord';
import { parseSalesOrders } from '../utils/parseSalesOrders';
import { calculateStockBalance, exportStockVerification } from '../utils/stockCalculator';
import toast from 'react-hot-toast';
import {
  ArrowLeft,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Download,
  Package,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ArrowDownUp,
  ShoppingCart,
  BarChart3,
  Users,
  AlertCircle,
} from 'lucide-react';

// LocalStorage keys for remembering uploads
const LS_SCR_KEY = 'stockVerifier_scrData';
const LS_TRANSFER_KEY = 'stockVerifier_transferFileName';

export default function StockVerifierPage() {
  const navigate = useNavigate();

  // Wizard step: 1 = Setup, 2 = Upload, 3 = Results
  const [step, setStep] = useState(1);

  // Step 1 state
  const [scrFile, setScrFile] = useState(null);
  const [scrData, setScrData] = useState(null); // parsed SCR registry map
  const [scrFileName, setScrFileName] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_SCR_KEY);
      return saved ? JSON.parse(saved).fileName : null;
    } catch { return null; }
  });
  const [branches, setBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Step 2 state
  const [transferFile, setTransferFile] = useState(null);
  const [transferFileName, setTransferFileName] = useState(() => {
    try {
      return localStorage.getItem(LS_TRANSFER_KEY) || null;
    } catch { return null; }
  });
  const [salesFile, setSalesFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState('');

  // Step 3 state
  const [results, setResults] = useState(null);
  const [activeResultTab, setActiveResultTab] = useState('summary');

  // Refs
  const scrInputRef = useRef(null);
  const transferInputRef = useRef(null);
  const salesInputRef = useRef(null);

  // ── SCR Registry Upload ──
  async function handleScrUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = await parseSCRRegistry(file);
      setScrData(parsed);
      setScrFile(file);
      setScrFileName(file.name);

      const branchNames = getBranchNames(parsed);
      setBranches(branchNames);

      // Save to localStorage
      localStorage.setItem(LS_SCR_KEY, JSON.stringify({
        fileName: file.name,
        uploadedAt: new Date().toISOString(),
      }));

      toast.success(`Loaded ${branchNames.length} branches from SCR registry`);
    } catch (err) {
      console.error('SCR Registry parse error:', err);
      toast.error(err.message || 'Failed to parse SCR registry file.');
    }

    if (scrInputRef.current) scrInputRef.current.value = '';
  }

  // ── Transfer Record Upload ──
  function handleTransferUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setTransferFile(file);
    setTransferFileName(file.name);

    localStorage.setItem(LS_TRANSFER_KEY, file.name);
    toast.success('Transfer record file loaded');

    if (transferInputRef.current) transferInputRef.current.value = '';
  }

  // ── Sales Upload ──
  function handleSalesUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSalesFile(file);
    toast.success('Sales orders file loaded');

    if (salesInputRef.current) salesInputRef.current.value = '';
  }

  // ── Process All Files ──
  async function handleProcess() {
    if (!scrData || !selectedBranch || !startDate || !endDate) {
      toast.error('Please complete all setup fields first.');
      return;
    }
    if (!transferFile) {
      toast.error('Please upload the Transfer Record file.');
      return;
    }
    if (!salesFile) {
      toast.error('Please upload the Sales Orders file.');
      return;
    }

    setProcessing(true);
    setProcessProgress('Identifying branch SCRs...');

    try {
      const branchSCRs = getSCRsForBranch(scrData, selectedBranch);
      if (branchSCRs.length === 0) {
        throw new Error(`No SCRs found for branch "${selectedBranch}".`);
      }

      setProcessProgress(`Found ${branchSCRs.length} SCRs. Parsing transfer records...`);

      // Parse transfers
      const transferData = await parseTransferRecord(
        transferFile,
        branchSCRs,
        new Date(startDate),
        new Date(endDate)
      );

      setProcessProgress(`Processed ${transferData.filteredRows.toLocaleString()} transfers. Parsing sales orders...`);

      // Parse sales
      const salesData = await parseSalesOrders(
        salesFile,
        selectedBranch,
        branchSCRs,
        new Date(startDate),
        new Date(endDate)
      );

      setProcessProgress('Calculating stock balance...');

      // Calculate balance
      const calculatedResults = calculateStockBalance(
        transferData,
        salesData,
        selectedBranch,
        branchSCRs
      );

      setResults(calculatedResults);
      setStep(3);
      toast.success('Stock verification complete!');
    } catch (err) {
      console.error('Processing error:', err);
      toast.error(err.message || 'Processing failed.');
    } finally {
      setProcessing(false);
      setProcessProgress('');
    }
  }

  // ── Export Results ──
  function handleExport() {
    if (!results) return;
    exportStockVerification(results, startDate, endDate);
    toast.success('Export downloaded!');
  }

  // ── Reset ──
  function handleReset() {
    setStep(1);
    setResults(null);
    setSalesFile(null);
    setActiveResultTab('summary');
  }

  // ── Validate step navigation ──
  const canProceedStep1 = scrData && selectedBranch && startDate && endDate && startDate <= endDate;
  const canProceedStep2 = transferFile && salesFile;

  return (
    <div className="app-container">
      <div className="page" style={{ paddingBottom: '5rem' }}>
        {/* Header */}
        <div className="page-header">
          <button
            onClick={() => navigate('/admin')}
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
            Back to Admin
          </button>
          <h1 className="page-title">
            <Package size={24} style={{ display: 'inline', marginRight: '0.5rem', verticalAlign: 'middle' }} />
            Stock Verifier
          </h1>
          <p className="page-subtitle">
            Verify branch stock balances against transfers and sales
          </p>
        </div>

        {/* ── Step Indicator ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          marginBottom: '1.5rem',
        }}>
          {[1, 2, 3].map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8125rem',
                fontWeight: 700,
                background: step >= s ? 'var(--color-primary)' : 'var(--color-border)',
                color: step >= s ? '#fff' : 'var(--color-text-muted)',
                transition: 'all 0.2s ease',
              }}>
                {step > s ? <CheckCircle2 size={16} /> : s}
              </div>
              {s < 3 && (
                <div style={{
                  width: 32,
                  height: 2,
                  background: step > s ? 'var(--color-primary)' : 'var(--color-border)',
                  transition: 'background 0.2s ease',
                }} />
              )}
            </div>
          ))}
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--color-text-muted)',
          marginBottom: '1.25rem',
          padding: '0 0.25rem',
        }}>
          <span style={{ color: step >= 1 ? 'var(--color-primary)' : undefined }}>Setup</span>
          <span style={{ color: step >= 2 ? 'var(--color-primary)' : undefined }}>Upload</span>
          <span style={{ color: step >= 3 ? 'var(--color-primary)' : undefined }}>Results</span>
        </div>

        {/* ═══════════ STEP 1: SETUP ═══════════ */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            {/* SCR Registry Upload */}
            <div className="card" style={{
              padding: '1.25rem',
              border: '1.5px solid var(--color-border)',
              boxShadow: 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Users size={18} color="var(--color-primary)" />
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0 }}>SCR Registry</h2>
              </div>

              {scrData ? (
                <div style={{
                  padding: '0.625rem 0.875rem',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '0.625rem',
                  marginBottom: '0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <CheckCircle2 size={15} color="var(--color-success)" />
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-success)' }}>
                      {branches.length} branches loaded
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '1.25rem', marginTop: '0.125rem' }}>
                    {scrFileName}
                  </div>
                </div>
              ) : scrFileName ? (
                <div style={{
                  padding: '0.625rem 0.875rem',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                  borderRadius: '0.625rem',
                  marginBottom: '0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <AlertCircle size={15} color="#f59e0b" />
                    <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#92400e' }}>
                      Previously used: {scrFileName} — please re-upload
                    </span>
                  </div>
                </div>
              ) : null}

              <input
                ref={scrInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleScrUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => scrInputRef.current?.click()}
                className="btn-outline"
                style={{
                  width: '100%',
                  minHeight: 44,
                  borderRadius: '0.625rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  border: '2px dashed var(--color-border)',
                  background: 'var(--color-bg)',
                  cursor: 'pointer',
                  color: 'var(--color-primary)',
                }}
              >
                {scrData ? <RefreshCw size={16} /> : <Upload size={16} />}
                {scrData ? 'Replace SCR Registry' : 'Upload SCR Registry (.xlsx)'}
              </button>
            </div>

            {/* Branch Selector */}
            {scrData && (
              <div>
                <label className="label" htmlFor="branch-select">Select Branch</label>
                <select
                  id="branch-select"
                  className="select"
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                >
                  <option value="">— Choose a branch —</option>
                  {branches.map((b) => {
                    const scrCount = getSCRsForBranch(scrData, b).length;
                    return (
                      <option key={b} value={b}>
                        {b} ({scrCount} SCR{scrCount !== 1 ? 's' : ''})
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {/* Date Range */}
            {scrData && (
              <div>
                <label className="label">Date Range</label>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <div style={{ flex: 1 }}>
                    <input
                      type="date"
                      className="input"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      style={{ fontSize: '0.875rem', padding: '0.625rem 0.75rem' }}
                    />
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', textAlign: 'center' }}>
                      Start Date
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', paddingBottom: '1rem', color: 'var(--color-text-muted)' }}>
                    →
                  </div>
                  <div style={{ flex: 1 }}>
                    <input
                      type="date"
                      className="input"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      style={{ fontSize: '0.875rem', padding: '0.625rem 0.75rem' }}
                    />
                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', textAlign: 'center' }}>
                      End Date
                    </div>
                  </div>
                </div>
                {startDate && endDate && startDate > endDate && (
                  <div style={{ color: 'var(--color-error)', fontSize: '0.8125rem', fontWeight: 600, marginTop: '0.25rem' }}>
                    Start date must be before end date
                  </div>
                )}
              </div>
            )}

            {/* SCR Preview */}
            {selectedBranch && scrData && (
              <div className="card" style={{
                padding: '1rem',
                border: '1.5px solid var(--color-border)',
                boxShadow: 'none',
                background: 'var(--color-bg)',
              }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                  SCRs for {selectedBranch}:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {getSCRsForBranch(scrData, selectedBranch).map((name, idx) => (
                    <span key={idx} className="badge badge-blue" style={{ fontSize: '0.6875rem' }}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Next Button */}
            <button
              className="btn btn-primary"
              onClick={() => setStep(2)}
              disabled={!canProceedStep1}
              style={{ borderRadius: '1rem', marginTop: '0.5rem' }}
            >
              Continue to Upload
              <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* ═══════════ STEP 2: UPLOAD FILES ═══════════ */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            {/* Context banner */}
            <div className="card" style={{
              padding: '0.875rem 1rem',
              border: 'none',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              color: '#fff',
            }}>
              <div style={{ fontSize: '0.8125rem', opacity: 0.85, fontWeight: 600 }}>Verifying</div>
              <div style={{ fontSize: '1.125rem', fontWeight: 800, marginTop: '0.125rem' }}>{selectedBranch}</div>
              <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.125rem' }}>
                {startDate} → {endDate} • {getSCRsForBranch(scrData, selectedBranch).length} SCRs
              </div>
            </div>

            {/* Transfer Record Upload */}
            <div className="card" style={{
              padding: '1.25rem',
              border: '1.5px solid var(--color-border)',
              boxShadow: 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <ArrowDownUp size={18} color="var(--color-primary)" />
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0 }}>Transfer Record</h2>
              </div>

              {transferFile && (
                <div style={{
                  padding: '0.625rem 0.875rem',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '0.625rem',
                  marginBottom: '0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <CheckCircle2 size={15} color="var(--color-success)" />
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-success)' }}>
                      File loaded
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '1.25rem', marginTop: '0.125rem' }}>
                    {transferFile.name}
                  </div>
                </div>
              )}

              <input
                ref={transferInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleTransferUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => transferInputRef.current?.click()}
                className="btn-outline"
                style={{
                  width: '100%',
                  minHeight: 44,
                  borderRadius: '0.625rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  border: '2px dashed var(--color-border)',
                  background: 'var(--color-bg)',
                  cursor: 'pointer',
                  color: 'var(--color-primary)',
                }}
              >
                {transferFile ? <RefreshCw size={16} /> : <Upload size={16} />}
                {transferFile ? 'Replace Transfer Record' : 'Upload Transfer Record (.xlsx)'}
              </button>
            </div>

            {/* Sales Upload */}
            <div className="card" style={{
              padding: '1.25rem',
              border: '1.5px solid var(--color-border)',
              boxShadow: 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <ShoppingCart size={18} color="var(--color-primary)" />
                <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, margin: 0 }}>Sales Orders</h2>
              </div>

              {salesFile && (
                <div style={{
                  padding: '0.625rem 0.875rem',
                  background: 'rgba(34, 197, 94, 0.08)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '0.625rem',
                  marginBottom: '0.75rem',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <CheckCircle2 size={15} color="var(--color-success)" />
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-success)' }}>
                      File loaded
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: '1.25rem', marginTop: '0.125rem' }}>
                    {salesFile.name}
                  </div>
                </div>
              )}

              <input
                ref={salesInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleSalesUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => salesInputRef.current?.click()}
                className="btn-outline"
                style={{
                  width: '100%',
                  minHeight: 44,
                  borderRadius: '0.625rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  border: '2px dashed var(--color-border)',
                  background: 'var(--color-bg)',
                  cursor: 'pointer',
                  color: 'var(--color-primary)',
                }}
              >
                {salesFile ? <RefreshCw size={16} /> : <Upload size={16} />}
                {salesFile ? 'Replace Sales File' : 'Upload Sales Orders (.xlsx)'}
              </button>
            </div>

            {/* Processing progress */}
            {processing && processProgress && (
              <div style={{
                padding: '0.875rem 1rem',
                background: 'rgba(37, 99, 235, 0.06)',
                border: '1px solid rgba(37, 99, 235, 0.15)',
                borderRadius: '0.75rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="spinner spinner-dark" style={{ width: 16, height: 16 }} />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                    {processProgress}
                  </span>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setStep(1)}
                disabled={processing}
                style={{ flex: 1, borderRadius: '1rem' }}
              >
                <ChevronLeft size={18} />
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleProcess}
                disabled={!canProceedStep2 || processing}
                style={{ flex: 2, borderRadius: '1rem' }}
              >
                {processing ? (
                  <div className="spinner" style={{ width: 18, height: 18 }} />
                ) : (
                  <>
                    <BarChart3 size={18} />
                    Verify Stock
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ═══════════ STEP 3: RESULTS ═══════════ */}
        {step === 3 && results && (
          <div className="flex flex-col gap-3">
            {/* Closing Balance Hero Card */}
            <div className="card" style={{
              padding: '1.5rem',
              border: 'none',
              background: results.closingBalance >= 0
                ? 'linear-gradient(135deg, #059669 0%, #047857 100%)'
                : 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
              color: '#fff',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '0.8125rem', opacity: 0.85, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Closing Stock — {results.branchName}
              </div>
              <div style={{ fontSize: '3rem', fontWeight: 800, marginTop: '0.25rem', lineHeight: 1 }}>
                {results.closingBalance}
              </div>
              <div style={{ fontSize: '0.875rem', opacity: 0.8, marginTop: '0.25rem' }}>
                units remaining
              </div>
              <div style={{ fontSize: '0.6875rem', opacity: 0.6, marginTop: '0.5rem' }}>
                As of {endDate}
              </div>
            </div>

            {/* Opening Balance Card */}
            <div className="card" style={{
              padding: '1rem 1.25rem',
              border: '2px solid var(--color-primary)',
              boxShadow: 'none',
              background: 'rgba(37, 99, 235, 0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                    Opening Stock (Carry-over)
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                    All activity before {startDate}
                  </div>
                </div>
                <div style={{
                  fontSize: '1.75rem',
                  fontWeight: 800,
                  color: results.openingBalance >= 0 ? 'var(--color-primary)' : 'var(--color-error)',
                }}>
                  {results.openingBalance}
                </div>
              </div>
            </div>

            {/* Period Activity Label */}
            <div style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '0.25rem 0.25rem 0',
            }}>
              Period Activity ({startDate} → {endDate})
            </div>

            {/* Period Activity Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div className="card" style={{ padding: '1rem', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.375rem' }}>
                  <TrendingUp size={14} color="var(--color-success)" />
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Received</span>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-success)' }}>
                  +{results.periodReceived}
                </div>
              </div>
              <div className="card" style={{ padding: '1rem', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.375rem' }}>
                  <TrendingDown size={14} color="var(--color-error)" />
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Sent Out</span>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-error)' }}>
                  −{results.periodSentOut}
                </div>
              </div>
              <div className="card" style={{ padding: '1rem', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.375rem' }}>
                  <ShoppingCart size={14} color="#8b5cf6" />
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Sold</span>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#8b5cf6' }}>
                  −{results.periodSold}
                </div>
              </div>
              <div className="card" style={{ padding: '1rem', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.375rem' }}>
                  <RefreshCw size={14} color="var(--color-text-muted)" />
                  <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Internal</span>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-muted)' }}>
                  {results.periodInternal}
                </div>
              </div>
            </div>

            {/* Ledger Formula */}
            <div style={{
              textAlign: 'center',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              padding: '0.625rem',
              background: 'var(--color-bg)',
              borderRadius: '0.5rem',
              border: '1px solid var(--color-border)',
              lineHeight: 1.6,
            }}>
              <div>{results.openingBalance} opening + {results.periodReceived} received − {results.periodSentOut} sent − {results.periodSold} sold</div>
              <div>= <strong style={{ color: 'var(--color-text)', fontSize: '0.875rem' }}>{results.closingBalance} closing balance</strong></div>
            </div>

            {/* Result Tabs */}
            <div style={{
              display: 'flex',
              background: 'var(--color-border)',
              padding: '0.25rem',
              borderRadius: '0.75rem',
              gap: '0.25rem',
            }}>
              {[
                { key: 'products', label: 'Products' },
                { key: 'scrs', label: 'SCRs' },
                { key: 'stats', label: 'Stats' },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveResultTab(tab.key)}
                  style={{
                    flex: 1,
                    minHeight: 36,
                    border: 'none',
                    borderRadius: '0.5rem',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: activeResultTab === tab.key ? 'var(--color-card)' : 'transparent',
                    color: activeResultTab === tab.key ? 'var(--color-text)' : 'var(--color-text-muted)',
                    boxShadow: activeResultTab === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content: Products */}
            {activeResultTab === 'products' && (
              <div className="card" style={{ padding: '1rem 1.25rem', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                  Products Sold (Period)
                </h3>
                {Object.keys(results.productBreakdown).length === 0 ? (
                  <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No products found in date range.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {Object.entries(results.productBreakdown)
                      .sort((a, b) => b[1] - a[1])
                      .map(([product, qty]) => (
                        <div key={product} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}>
                          <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{product}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{
                              height: 6,
                              borderRadius: 3,
                              background: '#8b5cf6',
                              width: Math.max(20, (qty / (results.periodSold || 1)) * 120),
                              transition: 'width 0.3s ease',
                            }} />
                            <span style={{ fontWeight: 700, fontSize: '0.875rem', minWidth: 28, textAlign: 'right' }}>
                              {qty}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab Content: SCRs */}
            {activeResultTab === 'scrs' && (
              <div className="flex flex-col gap-3">
                {results.perSCR.map((scr) => (
                  <div key={scr.name} className="card" style={{
                    padding: '1rem 1.25rem',
                    border: '1.5px solid var(--color-border)',
                    boxShadow: 'none',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9375rem', marginBottom: '0.5rem' }}>
                      {scr.name}
                    </div>

                    {/* Opening Balance */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '0.5rem',
                      padding: '0.375rem 0.5rem',
                      background: 'rgba(37, 99, 235, 0.06)',
                      borderRadius: '0.375rem',
                    }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)' }}>Opening</span>
                      <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'var(--color-primary)' }}>{scr.openingBalance}</span>
                    </div>

                    {/* Period Activity */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', fontSize: '0.8125rem' }}>
                      <div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.6875rem', fontWeight: 600 }}>Received</div>
                        <div style={{ fontWeight: 700, color: 'var(--color-success)' }}>+{scr.periodReceived}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.6875rem', fontWeight: 600 }}>Sent Out</div>
                        <div style={{ fontWeight: 700, color: 'var(--color-error)' }}>−{scr.periodSentOut}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.6875rem', fontWeight: 600 }}>Sold</div>
                        <div style={{ fontWeight: 700, color: '#8b5cf6' }}>−{scr.periodSold}</div>
                      </div>
                    </div>

                    {/* Closing Balance */}
                    <div style={{
                      marginTop: '0.5rem',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid var(--color-border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Closing Balance</span>
                      <span style={{
                        fontWeight: 800,
                        fontSize: '1rem',
                        color: scr.closingBalance >= 0 ? 'var(--color-success)' : 'var(--color-error)',
                      }}>
                        {scr.closingBalance}
                      </span>
                    </div>
                  </div>
                ))}

                {/* External sellers */}
                {results.otherSellers.length > 0 && (
                  <>
                    <div style={{
                      fontSize: '0.8125rem',
                      fontWeight: 700,
                      color: 'var(--color-text-muted)',
                      marginTop: '0.5rem',
                      padding: '0 0.25rem',
                    }}>
                      External Sellers (not branch SCRs)
                    </div>
                    {results.otherSellers.map((seller) => (
                      <div key={seller.name} className="card" style={{
                        padding: '0.875rem 1.25rem',
                        border: '1.5px dashed var(--color-border)',
                        boxShadow: 'none',
                        opacity: 0.8,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{seller.name}</div>
                            <span className="badge badge-gray" style={{ fontSize: '0.625rem', marginTop: '0.25rem' }}>External</span>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#8b5cf6' }}>
                              {seller.periodSold} sold
                            </div>
                            <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                              {seller.periodOrders} order{seller.periodOrders !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Tab Content: Stats */}
            {activeResultTab === 'stats' && (
              <div className="card" style={{ padding: '1rem 1.25rem', border: '1.5px solid var(--color-border)', boxShadow: 'none' }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                  Processing Statistics
                </h3>
                <div className="flex flex-col gap-3">
                  {[
                    { label: 'Transfer records scanned', value: results.stats.totalTransferRows.toLocaleString() },
                    { label: 'Transfers in period', value: results.stats.filteredTransferRows.toLocaleString() },
                    { label: 'Sales orders scanned', value: results.stats.totalSalesRows.toLocaleString() },
                    { label: 'Sales in period', value: results.stats.filteredSalesRows.toLocaleString() },
                    { label: 'Branch SCRs', value: results.perSCR.length },
                    { label: 'External sellers in period', value: results.otherSellers.length },
                  ].map((stat) => (
                    <div key={stat.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                      <span style={{ color: 'var(--color-text-muted)' }}>{stat.label}</span>
                      <span style={{ fontWeight: 700 }}>{stat.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={handleReset}
                style={{ flex: 1, borderRadius: '1rem' }}
              >
                <RefreshCw size={18} />
                New Verification
              </button>
              <button
                className="btn btn-primary"
                onClick={handleExport}
                style={{ flex: 2, borderRadius: '1rem' }}
              >
                <Download size={18} />
                Export Report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
