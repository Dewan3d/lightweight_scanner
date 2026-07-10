import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { exportToXlsx } from '../utils/exportXlsx';
import toast from 'react-hot-toast';
import { ArrowLeft, UserCheck, ShieldAlert, Search, Download, ChevronDown, ChevronUp, Users, Settings } from 'lucide-react';

export default function AdminPage() {
  const navigate = useNavigate();

  // Tab state
  const [activeTab, setActiveTab] = useState('users'); // 'users' or 'exports'

  // User Management states
  const [profiles, setProfiles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  // Branch Export states
  const [branchExportData, setBranchExportData] = useState([]); // [{ branch, scans: [...] }]
  const [exportLoading, setExportLoading] = useState(false);
  const [exportingId, setExportingId] = useState(null);

  // Load profiles and branch data (User Management)
  async function loadData() {
    try {
      // 1. Load all branches for lookup
      const { data: branchData } = await supabase
        .from('branches')
        .select('id, name');
      if (branchData) setBranches(branchData);

      // 2. Load all user profiles
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, branch_id');
      
      if (error) throw error;
      setProfiles(profileData || []);
    } catch (err) {
      console.error('Failed to load admin data:', err);
      toast.error('Failed to load user list.');
    } finally {
      setLoading(false);
    }
  }

  // Load branch export data
  async function loadBranchExportData() {
    setExportLoading(true);
    try {
      // Get all branches
      const { data: branchData, error: branchError } = await supabase
        .from('branches')
        .select('id, name')
        .order('name');
      if (branchError) throw branchError;

      // Get all scans with profile names (paginated to bypass Supabase's 1000 row limit)
      let allScans = [];
      let page = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: scans, error: scanError } = await supabase
          .from('scans')
          .select('id, barcode, paygo, scanned_by, branch_id, created_at, profiles ( full_name )')
          .order('created_at', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (scanError) throw scanError;

        if (scans && scans.length > 0) {
          allScans = [...allScans, ...scans];
          if (scans.length < pageSize) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      }

      // Group scans by branch
      const grouped = (branchData || []).map((branch) => ({
        branch,
        scans: allScans.filter((s) => s.branch_id === branch.id),
      }));

      setBranchExportData(grouped);
    } catch (err) {
      console.error('Failed to load branch export data:', err);
      toast.error('Failed to load export data.');
    } finally {
      setExportLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Load export data when switching to exports tab
  useEffect(() => {
    if (activeTab === 'exports' && branchExportData.length === 0) {
      loadBranchExportData();
    }
  }, [activeTab]);

  // Update a specific user's role
  async function handleRoleChange(profileId, newRole) {
    setUpdatingId(profileId);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ role: newRole })
        .eq('id', profileId);

      if (error) throw error;

      toast.success('Role updated successfully!');
      // Update local state instantly
      setProfiles((prev) =>
        prev.map((p) => (p.id === profileId ? { ...p, role: newRole } : p))
      );
    } catch (err) {
      console.error('Failed to update role:', err);
      toast.error(err.message || 'Failed to update role.');
    } finally {
      setUpdatingId(null);
    }
  }

  // Export scans for a specific branch
  async function handleBranchExport(branchItem, exportId) {
    setExportingId(exportId);
    try {
      if (branchItem.scans.length === 0) {
        toast.error('No scans to export for this branch.');
        return;
      }

      const formatted = branchItem.scans.map((s) => ({
        barcode: s.barcode,
        paygo: s.paygo,
        scanned_by_name: s.profiles?.full_name || s.scanned_by,
        branch_name: branchItem.branch.name,
        created_at: s.created_at,
      }));

      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `${branchItem.branch.name.replace(/\s+/g, '_')}_scans_${dateStr}`;
      exportToXlsx(formatted, filename);
      toast.success(`Exported ${branchItem.scans.length} scans for ${branchItem.branch.name}`);
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Export failed.');
    } finally {
      setExportingId(null);
    }
  }

  // Export all branches combined
  async function handleExportAll() {
    setExportingId('all');
    try {
      const allScans = branchExportData.flatMap((item) =>
        item.scans.map((s) => ({
          barcode: s.barcode,
          paygo: s.paygo,
          scanned_by_name: s.profiles?.full_name || s.scanned_by,
          branch_name: item.branch.name,
          created_at: s.created_at,
        }))
      );

      if (allScans.length === 0) {
        toast.error('No scans to export across all branches.');
        return;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      exportToXlsx(allScans, `All_Branches_scans_${dateStr}`);
      toast.success(`Exported ${allScans.length} scans across all branches`);
    } catch (err) {
      console.error('Export all failed:', err);
      toast.error('Export failed.');
    } finally {
      setExportingId(null);
    }
  }

  // Get branch name from lookup map
  function getBranchName(branchId) {
    if (!branchId) return 'No branch assigned';
    const b = branches.find((item) => item.id === branchId);
    return b ? b.name : 'Unknown Branch';
  }

  // Filter based on search query
  const filteredProfiles = profiles.filter((p) => {
    const name = (p.full_name || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query);
  });

  const totalScansAllBranches = branchExportData.reduce((sum, item) => sum + item.scans.length, 0);

  return (
    <div className="app-container">
      <div className="page" style={{ paddingBottom: '5rem' }}>
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
          <h1 className="page-title">Admin Console</h1>
          <p className="page-subtitle">Manage users and export branch data</p>
        </div>

        {/* Tab Selection */}
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
            onClick={() => setActiveTab('users')}
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
              background: activeTab === 'users' ? 'var(--color-card)' : 'transparent',
              color: activeTab === 'users' ? 'var(--color-text)' : 'var(--color-text-muted)',
              boxShadow: activeTab === 'users' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <Settings size={16} />
            User Management
          </button>
          <button
            onClick={() => setActiveTab('exports')}
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
              background: activeTab === 'exports' ? 'var(--color-card)' : 'transparent',
              color: activeTab === 'exports' ? 'var(--color-text)' : 'var(--color-text-muted)',
              boxShadow: activeTab === 'exports' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              fontFamily: 'var(--font-sans)',
            }}
          >
            <Download size={16} />
            Branch Exports
          </button>
        </div>

        {/* =================== TAB 1: User Management =================== */}
        {activeTab === 'users' && (
          <>
            {/* Search Bar */}
            <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--color-text-muted)',
                }}
              />
              <input
                type="text"
                className="input"
                style={{ paddingLeft: 40 }}
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Users List */}
            {loading ? (
              <div className="flex items-center justify-center flex-1" style={{ minHeight: 200 }}>
                <div className="spinner spinner-dark" style={{ width: 40, height: 40 }} />
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-muted" style={{ minHeight: 200 }}>
                <p style={{ fontSize: '1.125rem', fontWeight: 600 }}>No users found</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredProfiles.map((p) => {
                  const isUpdating = updatingId === p.id;
                  
                  return (
                    <div
                      key={p.id}
                      className="card flex flex-col gap-3"
                      style={{
                        border: '1.5px solid var(--color-border)',
                        boxShadow: 'none',
                        padding: '1rem',
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div style={{ minWidth: 0, flex: 1, paddingRight: '0.5rem' }}>
                          <div style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.full_name || 'No name set'}
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
                            {getBranchName(p.branch_id)}
                          </div>
                        </div>

                        <div style={{ flexShrink: 0 }}>
                          <span className={`badge ${p.role === 'SCR' ? 'badge-blue' : 'badge-gray'}`}>
                            {p.role === 'SCR' ? 'SCR' : 'DSA'}
                          </span>
                        </div>
                      </div>

                      {/* Dropdown for role editing */}
                      <div
                        style={{
                          borderTop: '1px solid var(--color-border)',
                          paddingTop: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '1rem',
                        }}
                      >
                        <label className="label" htmlFor={`role-select-${p.id}`} style={{ margin: 0, fontSize: '0.8125rem' }}>
                          Change Role:
                        </label>
                        <div style={{ flex: 1, maxWidth: 200, position: 'relative' }}>
                          <select
                            id={`role-select-${p.id}`}
                            className="select"
                            style={{ minHeight: 36, padding: '0.25rem 2rem 0.25rem 0.5rem', fontSize: '0.875rem' }}
                            value={p.role || 'DSA'}
                            onChange={(e) => handleRoleChange(p.id, e.target.value)}
                            disabled={isUpdating}
                          >
                            <option value="DSA">Direct Sales Agent (DSA)</option>
                            <option value="SCR">Service Centre Representative (SCR)</option>
                          </select>
                          {isUpdating && (
                            <div
                              style={{
                                position: 'absolute',
                                right: '2.5rem',
                                top: '50%',
                                transform: 'translateY(-50%)',
                              }}
                            >
                              <div className="spinner spinner-dark" style={{ width: 14, height: 14 }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* =================== TAB 2: Branch Exports =================== */}
        {activeTab === 'exports' && (
          <>
            {exportLoading ? (
              <div className="flex items-center justify-center flex-1" style={{ minHeight: 200 }}>
                <div className="spinner spinner-dark" style={{ width: 40, height: 40 }} />
              </div>
            ) : branchExportData.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-muted" style={{ minHeight: 200 }}>
                <p style={{ fontSize: '1.125rem', fontWeight: 600 }}>No branches found</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Summary card */}
                <div
                  className="card"
                  style={{
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    color: '#fff',
                    padding: '1.25rem',
                    border: 'none',
                  }}
                >
                  <div style={{ fontSize: '0.8125rem', opacity: 0.85, fontWeight: 600 }}>Total Across All Branches</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, marginTop: '0.25rem' }}>
                    {totalScansAllBranches.toLocaleString()}
                    <span style={{ fontSize: '1rem', fontWeight: 500, opacity: 0.8, marginLeft: '0.375rem' }}>scans</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.25rem' }}>
                    {branchExportData.filter((b) => b.scans.length > 0).length} of {branchExportData.length} branches with data
                  </div>
                </div>

                {/* Branch cards */}
                {branchExportData.map((item) => (
                  <div
                    key={item.branch.id}
                    className="card flex items-center justify-between"
                    style={{
                      padding: '1rem 1.25rem',
                      border: '1.5px solid var(--color-border)',
                      boxShadow: 'none',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>
                        {item.branch.name}
                      </div>
                      <span
                        className={`badge mt-1 ${item.scans.length > 0 ? 'badge-green' : 'badge-gray'}`}
                      >
                        {item.scans.length} scan{item.scans.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {item.scans.length > 0 && (
                      <button
                        className="btn-outline"
                        onClick={() => handleBranchExport(item, item.branch.id)}
                        disabled={exportingId === item.branch.id}
                        style={{
                          width: 'auto',
                          minHeight: 36,
                          padding: '0.25rem 0.75rem',
                          fontSize: '0.875rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          borderRadius: '0.5rem',
                          flexShrink: 0,
                        }}
                      >
                        {exportingId === item.branch.id ? (
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
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky Download All button (Branch Exports tab only) */}
      {activeTab === 'exports' && !exportLoading && totalScansAllBranches > 0 && (
        <div className="sticky-bottom">
          <button
            className="btn btn-secondary"
            onClick={handleExportAll}
            disabled={exportingId === 'all'}
            style={{ borderRadius: '1rem' }}
          >
            {exportingId === 'all' ? (
              <div className="spinner" />
            ) : (
              <>
                <Download size={20} />
                Download All Branches ({totalScansAllBranches.toLocaleString()} scans)
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
