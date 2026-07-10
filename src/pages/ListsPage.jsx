import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { exportToXlsx } from '../utils/exportXlsx';
import { ArrowLeft, Download, User, ChevronDown, ChevronUp, UserCheck, Users, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ListsPage() {
  const { user, profile, branch } = useAuth();
  const navigate = useNavigate();
  
  // Data states
  const [myScans, setMyScans] = useState([]);
  const [dsaList, setDsaList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exportingId, setExportingId] = useState(null); // Tracks which download is active
  
  // UI toggles
  const [activeTab, setActiveTab] = useState('me'); // 'me' or 'dsa'
  const [expandedDsaId, setExpandedDsaId] = useState(null); // ID of currently expanded DSA

  // Pending deletes: map of scan.id -> { timeout, scan } for undo support
  const pendingDeletesRef = useRef({});

  // Delete a scan with undo toast (optimistic removal, deferred DB delete)
  const deleteScan = useCallback((scan) => {
    // Optimistically remove from local state
    setMyScans((prev) => prev.filter((s) => s.id !== scan.id));

    // Create a toast with an Undo button
    const toastId = toast(
      (t) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.875rem' }}>Scan deleted</span>
          <button
            onClick={() => {
              // Undo: restore the scan and cancel the pending delete
              undoDelete(scan.id);
              toast.dismiss(t.id);
            }}
            style={{
              background: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '0.375rem',
              padding: '0.25rem 0.75rem',
              fontSize: '0.8125rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'var(--font-sans)',
              whiteSpace: 'nowrap',
            }}
          >
            Undo
          </button>
        </div>
      ),
      {
        duration: 5000,
        position: 'bottom-center',
        style: {
          background: 'var(--color-secondary)',
          color: '#fff',
        },
      }
    );

    // Schedule the actual DB delete after 5 seconds
    const timeout = setTimeout(async () => {
      delete pendingDeletesRef.current[scan.id];
      try {
        const { error } = await supabase.from('scans').delete().eq('id', scan.id);
        if (error) throw error;
      } catch (err) {
        console.error('Failed to delete scan:', err);
        // Restore on failure
        setMyScans((prev) => [scan, ...prev].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
        toast.error('Failed to delete scan. It has been restored.', { position: 'bottom-center' });
      }
    }, 5200); // Slightly longer than toast duration

    pendingDeletesRef.current[scan.id] = { timeout, scan, toastId };
  }, []);

  // Undo a pending delete
  const undoDelete = useCallback((scanId) => {
    const pending = pendingDeletesRef.current[scanId];
    if (pending) {
      clearTimeout(pending.timeout);
      // Restore the scan to local state in correct chronological position
      setMyScans((prev) => [pending.scan, ...prev].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      delete pendingDeletesRef.current[scanId];
    }
  }, []);

  // Cleanup pending timeouts on unmount by executing the deletes immediately
  useEffect(() => {
    return () => {
      Object.values(pendingDeletesRef.current).forEach(({ timeout, scan }) => {
        clearTimeout(timeout);
        // Execute the database delete immediately
        supabase.from('scans').delete().eq('id', scan.id).then(({ error }) => {
          if (error) {
            console.error('Failed to delete scan on unmount:', error);
          }
        });
      });
    };
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const isDSA = profile?.role === 'DSA';

        if (isDSA) {
          // DSA only needs their own scans
          const { data: scans, error: scanError } = await supabase
            .from('scans')
            .select('id, barcode, paygo, scanned_by, created_at')
            .eq('scanned_by', user.id)
            .order('created_at', { ascending: false });

          if (scanError) throw scanError;
          setMyScans(scans || []);
        } else {
          // SCR needs all profiles and scans in the branch
          // 1. Fetch all profiles in the branch to identify DSAs
          const { data: profiles, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, role')
            .eq('branch_id', profile.branch_id);

          if (profileError) throw profileError;

          // 2. Fetch all scans in the branch
          const { data: scans, error: scanError } = await supabase
            .from('scans')
            .select('id, barcode, paygo, scanned_by, created_at')
            .eq('branch_id', profile.branch_id)
            .order('created_at', { ascending: false });

          if (scanError) throw scanError;

          // 3. Segment "Scanned by Me"
          const filteredMyScans = (scans || []).filter((s) => s.scanned_by === user.id);
          setMyScans(filteredMyScans);

          // 4. Filter DSAs and map scans to them
          const dsas = (profiles || []).filter((p) => p.role === 'DSA');
          const dsasWithScans = dsas.map((dsa) => ({
            ...dsa,
            scans: (scans || []).filter((s) => s.scanned_by === dsa.id),
          }));

          setDsaList(dsasWithScans);
        }
      } catch (err) {
        console.error('Error loading scans list:', err);
      } finally {
        setLoading(false);
      }
    }

    if (profile && user) {
      loadData();
    }
  }, [profile, user]);

  // Export specific scans (my scans or a specific DSA's scans)
  async function handleExport(scanArray, labelName, exportId) {
    setExportingId(exportId);
    try {
      if (scanArray.length === 0) {
        alert('No scans to export.');
        return;
      }

      const formatted = scanArray.map((s) => ({
        barcode: s.barcode,
        paygo: s.paygo,
        scanned_by_name: labelName,
        branch_name: branch?.name || profile.branch_id,
        created_at: s.created_at,
      }));

      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `${labelName.replace(/\s+/g, '_')}_scans_${dateStr}`;

      exportToXlsx(formatted, filename);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed.');
    } finally {
      setExportingId(null);
    }
  }

  function formatTimestamp(ts) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const toggleDsaExpand = (id) => {
    setExpandedDsaId(expandedDsaId === id ? null : id);
  };

  const isDSA = profile?.role === 'DSA';

  return (
    <div className="app-container">
      <div className="page" style={{ paddingBottom: '5rem' }}>
        {/* Header */}
        <div className="page-header" style={{ marginBottom: '1rem' }}>
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
          <h1 className="page-title">{isDSA ? 'My Scans' : 'Branch Scans'}</h1>
          <p className="page-subtitle">
            {isDSA ? 'Scans logged by you' : (branch?.name || 'Unknown Branch')}
          </p>
        </div>

        {/* Tab Selection */}
        {!isDSA && (
          <div
            style={{
              display: 'flex',
              background: 'var(--color-border)',
              padding: '0.25rem',
              borderRadius: '0.75rem',
              marginBottom: '1.25rem',
              gap: '0.25rem',
            }}
          >
            <button
              onClick={() => setActiveTab('me')}
              style={{
                flex: 1,
                minHeight: 40,
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                background: activeTab === 'me' ? 'var(--color-card)' : 'transparent',
                color: activeTab === 'me' ? 'var(--color-text)' : 'var(--color-text-muted)',
                boxShadow: activeTab === 'me' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <UserCheck size={16} />
              Scanned by Me ({myScans.length})
            </button>
            <button
              onClick={() => setActiveTab('dsa')}
              style={{
                flex: 1,
                minHeight: 40,
                border: 'none',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                background: activeTab === 'dsa' ? 'var(--color-card)' : 'transparent',
                color: activeTab === 'dsa' ? 'var(--color-text)' : 'var(--color-text-muted)',
                boxShadow: activeTab === 'dsa' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <Users size={16} />
              DSA Scans ({dsaList.length})
            </button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center flex-1" style={{ minHeight: 200 }}>
            <div className="spinner spinner-dark" style={{ width: 40, height: 40 }} />
          </div>
        ) : activeTab === 'me' ? (
          /* Tab 1: Scanned by Me */
          myScans.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-muted" style={{ minHeight: 200 }}>
              <p style={{ fontSize: '1.125rem', fontWeight: 600 }}>No scans yet</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>Scans you capture will appear here.</p>
            </div>
          ) : (
            <div className="card overflow-auto" style={{ padding: '0.5rem' }}>
              <table className="scan-table">
                <thead>
                  <tr>
                    <th>Serial Number</th>
                    <th>Paygo Code</th>
                    <th>Time</th>
                    <th style={{ width: 40, textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {myScans.map((scan) => (
                    <tr key={scan.id}>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{scan.barcode}</td>
                      <td style={{ fontFamily: 'monospace', color: scan.paygo ? 'inherit' : 'var(--color-text-muted)' }}>
                        {scan.paygo || '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(scan.created_at)}</td>
                      <td style={{ textAlign: 'center', padding: '0.5rem 0.25rem' }}>
                        <button
                          className="delete-scan-btn"
                          onClick={() => deleteScan(scan)}
                          title="Delete this scan"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          /* Tab 2: DSA Scans */
          dsaList.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-muted" style={{ minHeight: 200 }}>
              <p style={{ fontSize: '1.125rem', fontWeight: 600 }}>No Agents registered</p>
              <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>There are no Direct Sales Agents in this branch.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {dsaList.map((dsa) => {
                const isExpanded = expandedDsaId === dsa.id;
                const dsaName = dsa.full_name || 'Agent';

                return (
                  <div
                    key={dsa.id}
                    className="card"
                    style={{
                      padding: '1rem',
                      border: '1.5px solid var(--color-border)',
                      boxShadow: 'none',
                    }}
                  >
                    {/* Header Row */}
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => toggleDsaExpand(dsa.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          cursor: 'pointer',
                          color: 'var(--color-text)',
                          fontFamily: 'var(--font-sans)',
                          textAlign: 'left',
                        }}
                      >
                        {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        <div>
                          <div style={{ fontWeight: 600 }}>{dsaName}</div>
                          <span className="badge badge-gray mt-1">
                            {dsa.scans.length} scan{dsa.scans.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </button>

                      {/* Export button for specific DSA */}
                      {dsa.scans.length > 0 && (
                        <button
                          className="btn-outline"
                          onClick={() => handleExport(dsa.scans, dsaName, dsa.id)}
                          disabled={exportingId === dsa.id}
                          style={{
                            width: 'auto',
                            minHeight: 36,
                            padding: '0.25rem 0.75rem',
                            fontSize: '0.875rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            borderRadius: '0.5rem',
                          }}
                        >
                          {exportingId === dsa.id ? (
                            <div className="spinner spinner-dark" style={{ width: 14, height: 14 }} />
                          ) : (
                            <>
                              <Download size={14} />
                              Export
                            </>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Collapsible Scans list */}
                    {isExpanded && (
                      <div style={{ marginTop: '1rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
                        {dsa.scans.length === 0 ? (
                          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', textAlign: 'center', padding: '0.5rem 0' }}>
                            No scans recorded by this agent.
                          </p>
                        ) : (
                          <div className="overflow-auto">
                            <table className="scan-table" style={{ fontSize: '0.8125rem' }}>
                              <thead>
                                <tr>
                                  <th>Serial Number</th>
                                  <th>Paygo Code</th>
                                  <th>Time</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dsa.scans.map((scan) => (
                                  <tr key={scan.id}>
                                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{scan.barcode}</td>
                                    <td style={{ fontFamily: 'monospace', color: scan.paygo ? 'inherit' : 'var(--color-text-muted)' }}>
                                      {scan.paygo || '—'}
                                    </td>
                                    <td style={{ whiteSpace: 'nowrap' }}>{formatTimestamp(scan.created_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Sticky Export button for current active view */}
      {!loading && (
        <div className="sticky-bottom">
          {activeTab === 'me' && myScans.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={() => handleExport(myScans, profile.full_name || 'My_Scans', 'me')}
              disabled={exportingId === 'me'}
              style={{ borderRadius: '1rem' }}
            >
              {exportingId === 'me' ? (
                <div className="spinner" />
              ) : (
                <>
                  <Download size={20} />
                  Export My Scans
                </>
              )}
            </button>
          )}

          {activeTab === 'dsa' && dsaList.some(d => d.scans.length > 0) && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                // Collect all DSA scans in one array for bulk export
                const allDsaScans = dsaList.flatMap(d => d.scans.map(s => ({
                  ...s,
                  scanned_by_name: d.full_name || d.id
                })));
                handleExport(allDsaScans, 'All_DSA_Scans', 'all_dsa');
              }}
              disabled={exportingId === 'all_dsa'}
              style={{ borderRadius: '1rem' }}
            >
              {exportingId === 'all_dsa' ? (
                <div className="spinner" />
              ) : (
                <>
                  <Download size={20} />
                  Export All DSA Scans
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
