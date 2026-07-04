import { redirect } from 'next/navigation';

// /dashboard 베어 경로는 홈 대시보드로 통합
export default function DashboardIndex() {
    redirect('/');
}
