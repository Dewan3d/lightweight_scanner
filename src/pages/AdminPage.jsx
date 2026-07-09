import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { ArrowLeft, UserCheck, ShieldAlert, Search } from 'lucide-react';

export default function AdminPage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [branches, setBranches] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);

  // Load profiles and branch data
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

  useEffect(() => {
    loadData();
  }, []);

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

  return (
    <div className="app-container">
      <div className="page">
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
          <p className="page-subtitle">Manage user roles and permissions</p>
        </div>

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
      </div>
    </div>
  );
}
