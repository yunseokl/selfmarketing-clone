'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './page.module.css';
import { ArrowLeft, RefreshCw, Megaphone, Pin, Edit2, Trash2, Eye, X } from 'lucide-react';
import { toast } from 'sonner';

const categoryOptions = [
    { id: 'notice', label: '공지' },
    { id: 'update', label: '업데이트' },
    { id: 'event', label: '이벤트' },
];

const categoryLabel = (category) => categoryOptions.find(c => c.id === category)?.label || category;

const emptyForm = { title: '', category: 'notice', content: '', isPinned: false };

export default function AdminNoticesPage() {
    const { status: sessionStatus } = useSession();
    const router = useRouter();
    const [notices, setNotices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState(emptyForm);
    const [editingId, setEditingId] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const fetchNotices = useCallback(async () => {
        try {
            setLoading(true);
            const res = await fetch('/api/admin/notices');
            if (res.ok) {
                const data = await res.json();
                setNotices(data.notices || []);
            }
        } catch (error) {
            console.error('Error fetching notices:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (sessionStatus === 'unauthenticated') {
            router.push('/login');
        } else if (sessionStatus === 'authenticated') {
            fetchNotices();
        }
    }, [fetchNotices, router, sessionStatus]);

    const handleEdit = (notice) => {
        setEditingId(notice.id);
        setForm({
            title: notice.title,
            category: notice.category,
            content: notice.content,
            isPinned: notice.isPinned,
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCancelEdit = () => {
        setEditingId(null);
        setForm(emptyForm);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.title.trim() || !form.content.trim()) {
            toast.error('제목과 내용을 입력해주세요.');
            return;
        }
        setSubmitting(true);
        try {
            const url = editingId ? `/api/admin/notices/${editingId}` : '/api/admin/notices';
            const method = editingId ? 'PATCH' : 'POST';
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
            });

            if (res.ok) {
                toast.success(editingId ? '공지가 수정되었습니다.' : '공지가 등록되었습니다.');
                handleCancelEdit();
                fetchNotices();
            } else {
                const data = await res.json();
                toast.error(data.error || '저장에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error saving notice:', error);
            toast.error('저장 중 오류가 발생했습니다.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (noticeId) => {
        if (!confirm('이 공지를 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(`/api/admin/notices/${noticeId}`, { method: 'DELETE' });
            if (res.ok) {
                toast.success('공지가 삭제되었습니다.');
                if (editingId === noticeId) handleCancelEdit();
                fetchNotices();
            } else {
                const data = await res.json();
                toast.error(data.error || '삭제에 실패했습니다.');
            }
        } catch (error) {
            console.error('Error deleting notice:', error);
            toast.error('삭제 중 오류가 발생했습니다.');
        }
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <Link href="/admin" className={styles.backBtn}>
                        <ArrowLeft size={20} />
                    </Link>
                    <div>
                        <h1 className={styles.title}>공지사항 관리</h1>
                        <p className={styles.subtitle}>공지 작성 및 수정/삭제</p>
                    </div>
                </div>
                <button className={styles.refreshBtn} onClick={fetchNotices}>
                    <RefreshCw size={18} />
                </button>
            </div>

            {/* Form */}
            <form className={styles.formCard} onSubmit={handleSubmit}>
                <div className={styles.formHeader}>
                    <h2>{editingId ? '공지 수정' : '새 공지 작성'}</h2>
                    {editingId && (
                        <button type="button" className={styles.cancelEditBtn} onClick={handleCancelEdit}>
                            <X size={14} />
                            수정 취소
                        </button>
                    )}
                </div>
                <div className={styles.formRow}>
                    <input
                        type="text"
                        className={styles.titleInput}
                        placeholder="제목을 입력하세요"
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                    />
                    <select
                        className={styles.categorySelect}
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                        {categoryOptions.map(opt => (
                            <option key={opt.id} value={opt.id}>{opt.label}</option>
                        ))}
                    </select>
                </div>
                <textarea
                    className={styles.contentTextarea}
                    placeholder="내용을 입력하세요"
                    value={form.content}
                    onChange={(e) => setForm({ ...form, content: e.target.value })}
                    rows={6}
                />
                <div className={styles.formFooter}>
                    <label className={styles.pinCheckbox}>
                        <input
                            type="checkbox"
                            checked={form.isPinned}
                            onChange={(e) => setForm({ ...form, isPinned: e.target.checked })}
                        />
                        상단 고정
                    </label>
                    <button type="submit" className={styles.submitBtn} disabled={submitting}>
                        {submitting ? '저장 중...' : editingId ? '수정 완료' : '공지 등록'}
                    </button>
                </div>
            </form>

            {/* List */}
            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th></th>
                            <th>카테고리</th>
                            <th>제목</th>
                            <th>조회수</th>
                            <th>날짜</th>
                            <th>작업</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6} className={styles.emptyCell}>로딩 중...</td>
                            </tr>
                        ) : notices.length === 0 ? (
                            <tr>
                                <td colSpan={6} className={styles.emptyCell}>
                                    <Megaphone size={48} className={styles.emptyIcon} />
                                    <p>등록된 공지가 없습니다.</p>
                                </td>
                            </tr>
                        ) : (
                            notices.map(notice => (
                                <tr key={notice.id}>
                                    <td>{notice.isPinned && <Pin size={14} className={styles.pinIcon} />}</td>
                                    <td><span className={styles.categoryBadge}>{categoryLabel(notice.category)}</span></td>
                                    <td className={styles.noticeTitle}>{notice.title}</td>
                                    <td className={styles.views}>
                                        <Eye size={12} />
                                        {notice.views}
                                    </td>
                                    <td>{formatDate(notice.createdAt)}</td>
                                    <td>
                                        <div className={styles.rowActions}>
                                            <button className={styles.iconBtn} onClick={() => handleEdit(notice)}>
                                                <Edit2 size={14} />
                                            </button>
                                            <button className={styles.iconBtnDanger} onClick={() => handleDelete(notice.id)}>
                                                <Trash2 size={14} />
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
