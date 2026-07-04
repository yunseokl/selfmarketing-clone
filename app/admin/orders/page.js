import { redirect } from 'next/navigation';

// /admin/orders 베어 경로는 쇼핑 주문 목록으로 이동
export default function AdminOrdersIndex() {
    redirect('/admin/orders/shopping');
}
