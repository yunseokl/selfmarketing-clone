'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import {
    ArrowLeft,
    Search,
    RefreshCw,
    User,
    DollarSign,
    Edit2,
    Save,
    X,
    KeyRound
} from 'lucide-react';

export default function UsersPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [editingUser, setEditingUser] = useState(null);
    const [editBalance, setEditBalance] = useState(0);

    const fetchUsers = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/users');
            if (res.ok) {
                const data = await res.json();
                setUsers(data.users || []);
            }
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/login');
        } else if (status === 'authenticated') {
            fetchUsers();
        }
    }, [fetchUsers, router, status]);

    const handleEditBalance = (user) => {
        setEditingUser(user.id);
        setEditBalance(user.balance);
    };

    const handleSaveBalance = async (userId) => {
        try {
            const res = await fetch(`/api/admin/users/${userId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ balance: parseInt(editBalance) }),
            });

            if (res.ok) {
                fetchUsers();
                setEditingUser(null);
            }
        } catch (error) {
            console.error('Error updating balance:', error);
        }
    };

    const handleResetPassword = async (user) => {
        if (!confirm(`${user.email} 회원의 비밀번호를 초기화하시겠습니까?\n임시 비밀번호가 발급되며, 기존 비밀번호는 즉시 사용할 수 없게 됩니다.`)) return;

        try {
            const res = await fetch(`/api/admin/users/${user.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resetPassword: true }),
            });
            const data = await res.json();

            if (res.ok) {
                // 임시 비밀번호는 이 알림에서만 확인 가능 — 관리자가 회원에게 직접 전달
                prompt('임시 비밀번호가 발급되었습니다. 아래 값을 복사해 회원에게 전달하세요. (다시 조회 불가)', data.tempPassword);
            } else {
                alert(data.error || '비밀번호 초기화에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error resetting password:', error);
            alert('비밀번호 초기화 중 오류가 발생했습니다.');
        }
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    };

    const filteredUsers = users.filter(user =>
        !searchQuery ||
        user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backBtn}>
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className={styles.title}>회원 관리</h1>
                        <p className={styles.subtitle}>전체 회원 목록 및 잔액 관리</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className={styles.filters}>
                <div className={styles.searchBar}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        type="text"
                        placeholder="이메일, 이름 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <button className={styles.refreshBtn} onClick={fetchUsers}>
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Table */}
            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>회원ID</th>
                            <th>이메일</th>
                            <th>이름</th>
                            <th>연락처</th>
                            <th>잔액</th>
                            <th>쇼핑광고</th>
                            <th>플레이스광고</th>
                            <th>순위추적</th>
                            <th>가입일</th>
                            <th>작업</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={10} className={styles.emptyCell}>로딩 중...</td>
                            </tr>
                        ) : filteredUsers.length === 0 ? (
                            <tr>
                                <td colSpan={10} className={styles.emptyCell}>
                                    <User size={48} className={styles.emptyIcon} />
                                    <p>회원이 없습니다.</p>
                                </td>
                            </tr>
                        ) : (
                            filteredUsers.map(user => (
                                <tr key={user.id}>
                                    <td className={styles.userId}>{user.id.slice(-8).toUpperCase()}</td>
                                    <td>{user.email}</td>
                                    <td>{user.name || '-'}</td>
                                    <td>{user.phone || '-'}</td>
                                    <td>
                                        {editingUser === user.id ? (
                                            <div className={styles.editBalance}>
                                                <input
                                                    type="number"
                                                    value={editBalance}
                                                    onChange={(e) => setEditBalance(e.target.value)}
                                                />
                                                <button onClick={() => handleSaveBalance(user.id)}>
                                                    <Save size={14} />
                                                </button>
                                                <button onClick={() => setEditingUser(null)}>
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <span className={styles.balance}>
                                                <DollarSign size={14} />
                                                {user.balance?.toLocaleString()}원
                                            </span>
                                        )}
                                    </td>
                                    <td>{user._count?.shoppingAds || 0}건</td>
                                    <td>{user._count?.placeAds || 0}건</td>
                                    <td>{user._count?.rankTracking || 0}건</td>
                                    <td>{formatDate(user.createdAt)}</td>
                                    <td>
                                        <div className={styles.rowActions}>
                                            <button
                                                className={styles.editBtn}
                                                onClick={() => handleEditBalance(user)}
                                            >
                                                <Edit2 size={14} />
                                                잔액 수정
                                            </button>
                                            <button
                                                className={styles.resetBtn}
                                                onClick={() => handleResetPassword(user)}
                                            >
                                                <KeyRound size={14} />
                                                비번 초기화
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
